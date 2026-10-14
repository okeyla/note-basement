import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_TITLE = 200;
const MAX_CONTENT = 100_000;
const MAX_CATEGORY = 30;
const FAIL_WINDOW_MIN = 15; // 同一 IP 在這段時間內密碼錯太多次就暫時鎖住
const FAIL_MAX = 10;
const COLUMNS = "id, title, content, visibility, category, created_at, updated_at";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class Fail extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const must = <T>(res: { data: T; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data;
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 同一 IP 短時間內錯太多次會被暫時鎖住，避免被人猜密碼
async function checkPassword(ip: string, password: unknown) {
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
  const recent = await db.from("auth_failures").select("*", { count: "exact", head: true }).eq("ip", ip).gt("at", since);
  if (recent.error) throw new Error(recent.error.message);
  if ((recent.count ?? 0) >= FAIL_MAX) throw new Fail(429, `密碼錯誤次數過多，請 ${FAIL_WINDOW_MIN} 分鐘後再試`);
  const cfg = must(await db.from("config").select("value").eq("key", "notes_password_sha256").maybeSingle());
  if (!cfg) throw new Fail(503, "尚未設定備忘錄密碼，請依 README 在 Supabase 設定");
  if (cfg.value === await sha256(String(password ?? ""))) return;
  must(await db.from("auth_failures").insert({ ip }));
  throw new Fail(401, "密碼不正確");
}

function noteId(id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Fail(404, "找不到這則備忘錄");
  return id;
}

// deno-lint-ignore no-explicit-any
const actions: Record<string, (b: any, ip: string) => Promise<unknown>> = {
  async list(b, ip) {
    await checkPassword(ip, b.password);
    const notes = must(await db.from("notes").select(COLUMNS).order("updated_at", { ascending: false })) ?? [];
    return { notes };
  },

  // 沒有 id 是新增，有 id 是修改
  async save(b, ip) {
    await checkPassword(ip, b.password);
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const content = typeof b.content === "string" ? b.content : "";
    const category = typeof b.category === "string" ? b.category.trim() : "";
    if (!title && !content.trim()) throw new Fail(400, "標題和內容至少要填一項");
    if (title.length > MAX_TITLE) throw new Fail(400, `標題最多 ${MAX_TITLE} 字`);
    if (content.length > MAX_CONTENT) throw new Fail(400, "內容太長了");
    if (category.length > MAX_CATEGORY) throw new Fail(400, `類別最多 ${MAX_CATEGORY} 字`);
    if (b.visibility !== "public" && b.visibility !== "private") throw new Fail(400, "請選擇公或私");
    const fields = { title, content, category, visibility: b.visibility };

    if (b.id == null) return { note: must(await db.from("notes").insert(fields).select(COLUMNS).single()) };
    const note = must(
      await db.from("notes").update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", noteId(b.id)).select(COLUMNS).maybeSingle(),
    );
    if (!note) throw new Fail(404, "這則備忘錄已經被刪除");
    return { note };
  },

  async remove(b, ip) {
    await checkPassword(ip, b.password);
    must(await db.from("notes").delete().eq("id", noteId(b.id)));
    return { deleted: true };
  },

  // AI 依標題與內容建議類別：尚未接上 AI 服務，介面先留著。
  // 接上後回傳 { category }，網頁會把它填進類別欄
  async classify(b, ip) {
    await checkPassword(ip, b.password);
    throw new Fail(501, "尚未接上 AI 分類，請先手動輸入類別");
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.action);
    if (!Object.hasOwn(actions, name)) return json({ error: "不支援的操作" }, 400);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    return json(await actions[name](body, ip));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "伺服器發生錯誤，請稍後再試" }, 500);
  }
});
