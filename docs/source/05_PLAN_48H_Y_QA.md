# THE1500 · Sprint intensivo y plan de aceptación (48 h)
**Versión:** 1.0 · **Riesgo:** Alto · **Criterio:** calidad mínima de seguridad antes de cobros reales

## Organización
- CTO/PM: ChatGPT define alcance, resuelve conflictos de contrato y audita evidencias.
- Core Lead: Claude. Único propietario de backend, migraciones, auth, IA, pagos y API.
- UX/Frontend Lead: Antigravity. Único propietario de UI, storytelling, conversión, visualizaciones y páginas.
- Propietario del negocio: habilita cuentas, dominio, llaves, términos y aprueba copy y producto.
- Git: `main` protegido, `feature/core-claude`, `feature/ux-antigravity`. Entrega por PR. No sobrescribir cambios de otro responsable.

## 0–4 horas | Conexión y contrato
**Claude**: inspección proyecto/repositorio, arquitectura, `API_CONTRACT.md`, DTO compartidos, D1 migrations y slots.
**Antigravity**: tokens de marca, layout, mapa de rutas, diseño wireframe para home y landing.
**Salida obligatoria**: endpoints y campos congelados v0.1; contratos tipados; dueño de cada archivo, repositorio compila.

## 4–12 horas | Core mínimo + experiencia
**Claude**: D1, 1.500 slots, órdenes, estados, auth básico, estadísticas, registros de compañías, tests de borde.
**Antigravity**: header/footer, directorio `/`, `/unirse` storytelling, navegación responsive, estados vacío/demo.
**Salida**: home conectado a estadísticas reales y ficha pública básica.

## 12–24 horas | Onboarding y corpus
**Claude**: generación semántica server-side, validadores, aprobaciones, snapshots JSON-LD, endpoints público y propietarios, FTS5.
**Antigravity**: `/registro`, `/mi-cuenta`, perfiles, explorador y filtros, fuentes y badges fieles al backend.
**Salida**: empresa autorizada puede crearse, generar perfil, aprobarse y visualizarse públicamente.

## 24–36 horas | Venta + chatbot
**Claude**: webhook sandbox + idempotencia, adaptador pagos, empresa fundadora, listado admin, API `/ask` grounded + rate-limit; role checks.
**Antigravity**: checkout visual, estados de pago, formularios Enterprise, chat con referencias, dashboard admin básico.
**Salida**: recorrido íntegro en sandbox, chat citando fichas reales publicadas.

## 36–44 horas | Integración y corrección
Merge controlado de PRs, migraciones staging, secretos separados, pruebas en navegador, revisión seguridad, accesibilidad, responsive, recuperación de fallos, contadores, búsqueda, bordes 600/601/1050/1051/1350/1351/1500.

## 44–48 horas | Lanzamiento condicionado
- Si DNS, correo, pasarela productiva, webhooks, términos, datos consentidos y pruebas están listos: despliegue comercial controlado.
- Si falta alguna dependencia de alto impacto: desplegar directorio y landing en staging o producción **sin aceptar pagos reales**, con formulario de interés y sin afirmar cupos vendidos.
- Entregar runbook, reportes de pruebas, lista de bloqueos y plan de conservación.

## Criterios GO/NO-GO (todos para habilitar cobros)
- [ ] EXACTAMENTE 1.500 slots, sin sobreventa en prueba concurrente.
- [ ] Precios correctos en puntos de cambio; fundadoras gratuitas ocupan inventario.
- [ ] Webhook con firma/verificación, importe, moneda, referencia e idempotencia comprobados.
- [ ] Cuenta ajena no puede ver/editar campos privados ni publicar contenido ajeno.
- [ ] Términos, privacidad y consentimiento de publicación aprobados por el operador.
- [ ] Documento de atribución de titularidad/autoridad del representante aceptado.
- [ ] Solo empresas publicadas aparecen en búsqueda, home y respuestas del chat.
- [ ] Los datos demo no aparecen como empresas reales.
- [ ] JSON-LD no incluye PII ni campos inventados; las fuentes respaldan las afirmaciones.
- [ ] No se promete ranking ni indexación de IA externa.
- [ ] Sin checkout automático en fase Enterprise; ruta aplicación manual funcional.
- [ ] Logs y fallos seguros; rollback y exportación de DB/snapshots practicables.
- [ ] Sitio verificable en móvil y escritorio, sin rutas rotas ni CTA engañosos.

## Pruebas de aceptación en lenguaje de negocio
1. Usuario llega a `/`, ve el número real de empresas **publicadas** y entra a una ficha.
2. Usuario llega a `/unirse`, comprende producto, precio, cupos disponibles y qué recibe.
3. Empresa fundadora entra gratis y consume plaza de fase I. El contador cambia.
4. Empresa normal paga en sandbox y, tras webhook, conserva plaza pese a recarga del navegador.
5. Pago rechazado no adjudica plaza; webhook repetido no duplica.
6. Empresa introduce servicios; IA propone perfil; humana aprueba; se publica HTML y JSON-LD.
7. Chat responde consultando solo fichas publicadas, con links. Si no hay resultados, lo dice.
8. A la posición 1.351 el checkout se desactiva y aparece solicitud Enterprise.
9. Tras la posición 1.500, home sigue público y `/unirse` indica cupos agotados.
10. Un no administrador no puede asignar empresa fundadora ni modificar cupos.

## Fuera del alcance del sprint
- Corpus inicial de 50–100 empresas reales ya contactadas: depende de acuerdos y recolección de datos; no simular.
- Ingesta masiva sin revisión de titulares.
- Vector DB y knowledge graph especializado; FTS5 basta para demostración funcional inicial.
- Métricas inventadas de impresiones/recomendaciones externas.
- Actualizaciones periódicas obligatorias o suscripciones.
- Multiidioma, CRM, billing internacional sofisticado y facturación tributaria automatizada.

## Evidencia exigida
Para cada checklist: archivo o URL de staging, comando de prueba, resultado y captura o log no sensible. El informe final no usa «100% completo» si hay bloqueos de servicios externos.
