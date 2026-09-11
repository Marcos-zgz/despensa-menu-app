// Manejador central de la base de datos D1 para Cloudflare Pages
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  const method = request.method;

  const db = env.DB; // Binding a Cloudflare D1

  try {
    // 1. ENDPOINTS DE ALIMENTOS
    if (path === 'alimentos') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM alimentos ORDER BY created_at DESC").all();
        return Response.json(results);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO alimentos (id, nombre, icono, en_stock) VALUES (?, ?, ?, 1)")
          .bind(id, body.nombre, body.icono).run();
        return Response.json({ success: true, id });
      }
      if (method === 'PATCH') {
        const body = await request.json();
        await db.prepare("UPDATE alimentos SET en_stock = ? WHERE id = ?")
          .bind(body.en_stock, body.id).run();
        return Response.json({ success: true });
      }
    }

    // 2. ENDPOINTS DE MENÚS (15 DÍAS)
    if (path === 'menu') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM menu_dias").all();
        const mapa = {};
        results.forEach(r => {
          mapa[`${r.fecha}_${r.momento}`] = r.descripcion;
        });
        return Response.json(mapa);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = crypto.randomUUID();
        await db.prepare(`
          INSERT INTO menu_dias (id, fecha, momento, descripcion)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(fecha, momento) DO UPDATE SET descripcion=excluded.descripcion
        `).bind(id, body.fecha, body.momento, body.descripcion).run();
        return Response.json({ success: true });
      }
    }

    // 3. ENDPOINTS DE LISTA DE LA COMPRA
    if (path === 'compra') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM lista_compra ORDER BY comprado ASC, created_at DESC").all();
        return Response.json(results);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO lista_compra (id, item, icono, comprado) VALUES (?, ?, ?, 0)")
          .bind(id, body.item, body.icono).run();
        return Response.json({ success: true, id });
      }
      if (method === 'PATCH') {
        const body = await request.json();
        await db.prepare("UPDATE lista_compra SET comprado = ? WHERE id = ?")
          .bind(body.comprado, body.id).run();
        return Response.json({ success: true });
      }
      if (method === 'DELETE') {
        const body = await request.json();
        await db.prepare("DELETE FROM lista_compra WHERE id = ?")
          .bind(body.id).run();
        return Response.json({ success: true });
      }
    }

    if (path === 'compra-limpiar' && method === 'POST') {
      await db.prepare("DELETE FROM lista_compra WHERE comprado = 1").run();
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
