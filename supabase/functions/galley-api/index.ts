import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

async function getAdminFromToken(token: string | null) {
  if (!token) return null;
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return null;
  const { data: adminRow } = await service
    .from("galley_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return adminRow ? user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "list";
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (req.method === "GET" && action === "list") {
      const { data, error } = await service
        .from("galley_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ items: data || [] });
    }

    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      const { data, error } = await service
        .from("galley_items")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return json({ error: error.message }, 404);
      return json({ item: data });
    }

    if (req.method === "GET" && action === "setup-status") {
      const { count, error } = await service.from("galley_admins").select("user_id", { count: "exact", head: true });
      if (error) return json({ error: error.message }, 500);
      const { data, error: settingsError } = await service.from("galley_settings").select("claim_token").eq("id", true).maybeSingle();
      if (settingsError) return json({ error: settingsError.message }, 500);
      return json({ setup_available: count === 0 && !!data?.claim_token });
    }

    // Bootstrap exactly one owner using the existing secret, then retire that secret.
    if (req.method === "POST" && action === "setup") {
      const body = await req.json();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const code = String(body.code || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
        return json({ error: "请填写有效邮箱，并设置至少 10 位的密码。" }, 400);
      }
      const { count, error: countError } = await service.from("galley_admins").select("user_id", { count: "exact", head: true });
      if (countError) return json({ error: countError.message }, 500);
      if (count !== 0) return json({ error: "管理员账号已经设置，请直接登录。" }, 409);
      const { data: settings, error: settingsError } = await service.from("galley_settings").select("claim_token").eq("id", true).maybeSingle();
      if (settingsError) return json({ error: settingsError.message }, 500);
      if (!settings?.claim_token || code !== settings.claim_token) return json({ error: "管理码不正确。" }, 403);

      const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError || !created.user) return json({ error: createError?.message || "账号创建失败。" }, 400);
      // Compare-and-clear ensures concurrent requests cannot both become administrators.
      const { data: claimed, error: claimError } = await service.from("galley_settings").update({ claim_token: null }).eq("id", true).eq("claim_token", code).select("id").maybeSingle();
      if (claimError || !claimed) {
        await service.auth.admin.deleteUser(created.user.id);
        return json({ error: claimError?.message || "管理员账号正在设置，请稍后登录。" }, 409);
      }
      const { error: insertError } = await service.from("galley_admins").insert({ user_id: created.user.id });
      if (insertError) {
        await service.from("galley_settings").update({ claim_token: code }).eq("id", true).is("claim_token", null);
        await service.auth.admin.deleteUser(created.user.id);
        return json({ error: insertError.message }, 500);
      }
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "login") {
      const body = await req.json();
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data, error } = await anon.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });
      if (error) return json({ error: error.message }, 401);
      const admin = await getAdminFromToken(data.session.access_token);
      if (!admin) return json({ error: "此账号没有管理权限。" }, 403);
      return json({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
        user: { id: data.user.id, email: data.user.email },
      });
    }

    if (req.method === "POST" && action === "refresh") {
      const body = await req.json();
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data, error } = await anon.auth.refreshSession({
        refresh_token: body.refresh_token,
      });
      if (error || !data.session) return json({ error: error?.message || "Refresh failed" }, 401);
      return json({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
        },
      });
    }

    if (req.method === "POST" && action === "verify") {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      const admin = await getAdminFromToken(token);
      return json({ admin: !!admin, email: admin?.email || null });
    }

    if (req.method === "POST" && action === "logout") {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (token) await service.auth.admin.signOut(token, "local");
      return json({ ok: true });
    }

    if (["POST", "PUT", "DELETE"].includes(req.method)) {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      const admin = await getAdminFromToken(token);
      if (!admin) return json({ error: "Admin authentication required" }, 401);

      if (req.method === "POST" && action === "upsert") {
        const body = await req.json();
        const item = body.item;
        if (!item?.id || !item?.title) return json({ error: "Invalid item" }, 400);
        item.updated_at = new Date().toISOString();
        const { data, error } = await service
          .from("galley_items")
          .upsert(item, { onConflict: "id" })
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ item: data });
      }

      if (req.method === "POST" && action === "bulk") {
        const body = await req.json();
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return json({ error: "No items" }, 400);
        const now = new Date().toISOString();
        const clean = items
          .filter((x: any) => x && x.id && x.title)
          .map((x: any) => ({ ...x, updated_at: now }));
        const { data, error } = await service
          .from("galley_items")
          .upsert(clean, { onConflict: "id" })
          .select();
        if (error) return json({ error: error.message }, 400);
        return json({ items: data || [], count: data?.length || 0 });
      }

      if (req.method === "DELETE" && action === "delete") {
        const body = await req.json();
        if (!body.id) return json({ error: "Missing id" }, 400);
        const { error } = await service.from("galley_items").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
