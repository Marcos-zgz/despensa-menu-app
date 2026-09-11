export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  const method = request.method;
  const db = env.DB;

  try {
    // 1. ALIMENTOS
    if (path === 'alimentos') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM alimentos ORDER BY created_at DESC").all();
        return Response.json(results || []);
      }
      if (method === 'POST') {
        const body = await request.json();
        const nombreLimpio = (body.nombre || '').trim();
        const unidadesSumar = parseInt(body.unidades) || 1;

        const existente = await db.prepare("SELECT * FROM alimentos WHERE LOWER(TRIM(nombre)) = LOWER(?)")
          .bind(nombreLimpio).first();

        if (existente) {
          await db.prepare("UPDATE alimentos SET unidades = unidades + ?, en_stock = 1 WHERE id = ?")
            .bind(unidadesSumar, existente.id).run();
          return Response.json({ success: true, updated: true, id: existente.id });
        } else {
          const id = crypto.randomUUID();
          await db.prepare("INSERT INTO alimentos (id, nombre, icono, unidades, en_stock) VALUES (?, ?, '', ?, ?)")
            .bind(id, nombreLimpio, unidadesSumar, unidadesSumar > 0 ? 1 : 0).run();
          return Response.json({ success: true, created: true, id });
        }
      }
      if (method === 'PATCH') {
        const body = await request.json();
        
        // Sumar o restar unidades
        if (body.delta !== undefined) {
          // Obtener el alimento actual
          const alim = await db.prepare("SELECT * FROM alimentos WHERE id = ?").bind(body.id).first();
          if (alim) {
            const nuevasUnidades = Math.max(0, alim.unidades + body.delta);
            const enStock = nuevasUnidades > 0 ? 1 : 0;
            
            await db.prepare("UPDATE alimentos SET unidades = ?, en_stock = ? WHERE id = ?")
              .bind(nuevasUnidades, enStock, body.id).run();

            // SI SE AGOTÓ AL RESTAR (delta < 0 y unidades = 0): METER DIRECTO A LA LISTA DE LA COMPRA
            if (body.delta < 0 && nuevasUnidades === 0) {
              const existeEnCompra = await db.prepare("SELECT * FROM lista_compra WHERE LOWER(TRIM(item)) = LOWER(?) AND comprado = 0")
                .bind(alim.nombre.trim()).first();
              
              if (!existeEnCompra) {
                const idCompra = crypto.randomUUID();
                await db.prepare("INSERT INTO lista_compra (id, item, icono, comprado) VALUES (?, ?, '', 0)")
                  .bind(idCompra, alim.nombre.trim()).run();
              }
            }
          }
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

    // 3. COMPRA
    if (path === 'compra') {
      if (method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM lista_compra ORDER BY comprado ASC, created_at DESC").all();
        return Response.json(results || []);
      }
      if (method === 'POST') {
        const body = await request.json();
        const itemLimpio = (body.item || '').trim();
        const existe = await db.prepare("SELECT * FROM lista_compra WHERE LOWER(TRIM(item)) = LOWER(?) AND comprado = 0")
          .bind(itemLimpio).first();

        if (!existe) {
          const id = crypto.randomUUID();
          await db.prepare("INSERT INTO lista_compra (id, item, icono, comprado) VALUES (?, ?, '', 0)")
            .bind(id, itemLimpio).run();
        }
        return Response.json({ success: true });
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
