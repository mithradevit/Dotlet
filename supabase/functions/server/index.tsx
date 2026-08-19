import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";
import { get, set, del, getByPrefix } from "./kv_store.tsx";

const app = new Hono();
app.use('*', logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

const P = "/make-server-3e538714";

const adminSb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const anonSb  = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

async function authedUser(authHeader: string | null) {
  if (!authHeader) return null;
  const { data, error } = await anonSb().auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !data.user) return null;
  return data.user;
}

app.get(`${P}/health`, (c) => c.json({ status: "ok" }));

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post(`${P}/auth/send-otp`, async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "email required" }, 400);
  const { error } = await anonSb().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) { console.log("send-otp error:", error.message); return c.json({ error: error.message }, 400); }
  return c.json({ ok: true });
});

app.post(`${P}/auth/verify-otp`, async (c) => {
  const { email, token } = await c.req.json();
  if (!email || !token) return c.json({ error: "email and token required" }, 400);
  const { data, error } = await anonSb().auth.verifyOtp({ email, token, type: "email" });
  if (error) { console.log("verify-otp error:", error.message); return c.json({ error: error.message }, 400); }
  return c.json({ session: data.session, user: data.user });
});

// ── Files ─────────────────────────────────────────────────────────────────────
app.get(`${P}/files`, async (c) => {
  const user = await authedUser(c.req.header("Authorization") ?? null);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const sb = adminSb();
  const records = await getByPrefix(sb, `files:${user.id}:`);
  const files = records
    .map((r: { key: string; value: string }) => {
      const p = JSON.parse(r.value);
      return { id: r.key.replace(`files:${user.id}:`, ""), name: p.name ?? "Untitled", updatedAt: p.updatedAt ?? null, canvas: p.canvas ?? null };
    })
    .sort((a: { updatedAt: string }, b: { updatedAt: string }) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return c.json({ files });
});

app.post(`${P}/files`, async (c) => {
  const user = await authedUser(c.req.header("Authorization") ?? null);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { id, name, canvas } = await c.req.json();
  if (!id || !canvas) return c.json({ error: "id and canvas required" }, 400);
  await set(adminSb(), `files:${user.id}:${id}`, JSON.stringify({ name: name ?? "Untitled", updatedAt: new Date().toISOString(), canvas }));
  return c.json({ ok: true, id });
});

app.put(`${P}/files/:id/name`, async (c) => {
  const user = await authedUser(c.req.header("Authorization") ?? null);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const key = `files:${user.id}:${c.req.param("id")}`;
  const existing = await get(adminSb(), key);
  if (!existing) return c.json({ error: "not found" }, 404);
  const parsed = JSON.parse(existing);
  await set(adminSb(), key, JSON.stringify({ ...parsed, name: (await c.req.json()).name ?? "Untitled", updatedAt: new Date().toISOString() }));
  return c.json({ ok: true });
});

app.delete(`${P}/files/:id`, async (c) => {
  const user = await authedUser(c.req.header("Authorization") ?? null);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await del(adminSb(), `files:${user.id}:${c.req.param("id")}`);
  return c.json({ ok: true });
});

Deno.serve(app.fetch);
