export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  const method = request.method;
  const db = env.DB;

  try {
    // 1. ALIMENTOS (CON SUMA AUTOMÁTICA SI YA EXISTE)
    if (path === 'alimentos') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM alimentos ORDER BY created_at DESC").all();
        return Response.json(results || []);
      }
      if (method === 'POST') {
        const body = await request.json();
        const nombreLimpio = (body.nombre || '').trim();
        const unidadesSumar = parseInt(body.unidades) || 1;

        // Comprobar si ya existe (sin importar mayúsculas/minúsculas)
        const existente = await db.prepare("SELECT * FROM alimentos WHERE LOWER(TRIM(nombre)) = LOWER(?)")
          .bind(nombreLimpio).first();

        if (existente) {
          // Si existe, se suman las unidades y se asegura que esté en stock
          await db.prepare("UPDATE alimentos SET unidades = unidades + ?, en_stock = 1 WHERE id = ?")
            .bind(unidadesSumar, existente.id).run();
          return Response.json({ success: true, updated: true, id: existente.id });
        } else {
          // Si no existe, se inserta
          const id = crypto.randomUUID();
          await db.prepare("INSERT INTO alimentos (id, nombre, icono, unidades, en_stock) VALUES (?, ?, '', ?, ?)")
            .bind(id, nombreLimpio, unidadesSumar, unidadesSumar > 0 ? 1 : 0).run();
          return Response.json({ success: true, created: true, id });
        }
      }
      if (method === 'PATCH') {
        const body = await request.json();
        if (body.delta !== undefined) {
          await db.prepare("UPDATE alimentos SET unidades = MAX(0, unidades + ?), en_stock = CASE WHEN (unidades + ?) > 0 THEN 1 ELSE 0 END WHERE id = ?")
            .bind(body.delta, body.delta, body.id).run();
        } else {
          await db.prepare("UPDATE alimentos SET en_stock = ?, unidades = ? WHERE id = ?")
            .bind(body.en_stock, body.unidades, body.id).run();
        }
        return Response.json({ success: true });
      }
      if (method === 'DELETE') {
        const body = await request.json();
        await db.prepare("DELETE FROM alimentos WHERE id = ?").bind(body.id).run();
        return Response.json({ success: true });
      }
    }

    // 2. MENÚS
    if (path === 'menu') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM menu_dias").all();
        const mapa = {};
        (results || []).forEach(r => {
          let items = [];
          try { items = JSON.parse(r.alimentos_usados || '[]'); } catch(e) { items = []; }
          mapa[`${r.fecha}_${r.momento}`] = {
            descripcion: r.descripcion || '',
            items: items,
            consumido: r.descripcion === 'CONSUMIDO'
          };
        });
        return Response.json(mapa);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = crypto.randomUUID();
        const itemsJson = JSON.stringify(body.items || []);
        const flagConsumido = body.consumido ? 'CONSUMIDO' : '';
        
        await db.prepare(`
          INSERT INTO menu_dias (id, fecha, momento, descripcion, alimentos_usados)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(fecha, momento) DO UPDATE SET 
            descripcion = excluded.descripcion,
            alimentos_usados = excluded.alimentos_usados
        `).bind(id, body.fecha, body.momento, flagConsumido, itemsJson).run();
        
        return Response.json({ success: true });
      }
    }

    // 3. LISTA DE LA COMPRA
    if (path === 'compra') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM lista_compra ORDER BY comprado ASC, created_at DESC").all();
        return Response.json(results || []);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO lista_compra (id, item, icono, comprado) VALUES (?, ?, '', 0)")
          .bind(id, (body.item || '').trim()).run();
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
        await db.prepare("DELETE FROM lista_compra WHERE id = ?").bind(body.id).run();
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
