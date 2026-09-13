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
        
        if (body.delta !== undefined) {
          const alim = await db.prepare("SELECT * FROM alimentos WHERE id = ?").bind(body.id).first();
          if (alim) {
            const nuevasUnidades = Math.max(0, alim.unidades + body.delta);
            const enStock = nuevasUnidades > 0 ? 1 : 0;
            
            await db.prepare("UPDATE alimentos SET unidades = ?, en_stock = ? WHERE id = ?")
              .bind(nuevasUnidades, enStock, body.id).run();

            // Si se agota al consumir: directo a la compra
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

    // 3. COMPRA (AL TACHAR, REPONE LA DESPENSA AUTOMÁTICAMENTE)
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
        
        // 1. Actualizar estado de compra
        await db.prepare("UPDATE lista_compra SET comprado = ? WHERE id = ?")
          .bind(body.comprado, body.id).run();

        // 2. Si se tacha (comprado = 1) o se desmarca (comprado = 0), sincronizar con la despensa
        const itemCompra = await db.prepare("SELECT * FROM lista_compra WHERE id = ?").bind(body.id).first();
        if (itemCompra) {
          const nomLimpio = itemCompra.item.trim();
          const existente = await db.prepare("SELECT * FROM alimentos WHERE LOWER(TRIM(nombre)) = LOWER(?)")
            .bind(nomLimpio).first();

          if (body.comprado === 1) {
            // Se compró: reponer +1 unidad (o +2 si estaba a 0)
            if (existente) {
              const incremento = existente.unidades === 0 ? 2 : 1;
              await db.prepare("UPDATE alimentos SET unidades = unidades + ?, en_stock = 1 WHERE id = ?")
                .bind(incremento, existente.id).run();
            } else {
              const idNuevo = crypto.randomUUID();
              await db.prepare("INSERT INTO alimentos (id, nombre, icono, unidades, en_stock) VALUES (?, ?, '', 2, 1)")
                .bind(idNuevo, nomLimpio).run();
            }
          } else {
            // Se desmarcó por error: restar 1 unidad
            if (existente) {
              await db.prepare("UPDATE alimentos SET unidades = MAX(0, unidades - 1), en_stock = CASE WHEN unidades - 1 > 0 THEN 1 ELSE 0 END WHERE id = ?")
                .bind(existente.id).run();
            }
          }
        }

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
