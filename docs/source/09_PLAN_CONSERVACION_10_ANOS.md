# THE1500 · Plan de conservación y costos tras cierre comercial
**Versión:** 1.1 | **Fecha:** 2026-11-03 | **Naturaleza:** política técnica propuesta pendiente de formalización contractual

## 1. Objetivo correcto
THE1500 se desarrolla, comercializa y aprovecha intensivamente ahora. Una vez vendidas las 1.500 plazas, la plataforma permanece publicada como registro semántico de las empresas incorporadas. **No incluye compromiso general de actualización, mejora continua ni operación de IA ilimitada durante 10 años.** Sí exige resolver seguridad, disponibilidad, rectificaciones legales y custodia según contrato y normativa aplicable.

## 2. Arquitectura de dos modos
**`selling`:** landing de ventas, registro, pagos, procesos de generación IA, asistentes y panel mínimo. Costos variables y soporte activos.

**`closed_archive`:** `/` directorio público, fichas HTML y JSON-LD, búsqueda de bajo costo, sección comercial cerrada. Desactivar checkout y nuevas altas. Conservar chatbot únicamente si presupuesto y condiciones comerciales lo justifican; alternativa es búsqueda determinista sin LLM. No prometer chatbot 24/7 a una década sin presupuesto.

## 3. Archivo estático y portabilidad
Al cierre generar exportación firmada o con manifiesto (listado de IDs, rutas, checksums, fecha, versión del esquema), páginas HTML y JSON-LD exportables por empresa, más respaldo consistente de la base D1. Mantener las URLs estables y redirecciones de slugs anteriores. Evitar dependencias de proveedores que impidan restauración fuera de Cloudflare.

## 4. Respaldos y restauración
- Definir antes de producción frecuencia y retención de respaldos, almacenamiento geográficamente independiente y control de acceso; demostrar restauración en staging antes de vender.
- Exportar D1 y snapshots públicos hacia segunda ubicación bajo credenciales distintas. Cifrar los respaldos privados y limitar su acceso.
- Documentar RPO/RTO objetivo **antes de incluir garantías de servicio en términos**; no prometer disponibilidad absoluta.
- Probar restauración trimestral durante etapa comercial y establecer revisión periódica mínima de conservación tras cierre; el detalle queda sujeto a presupuesto y riesgo.

## 5. Reserva financiera y obligaciones
La recaudación del proyecto no equivale a presupuesto disponible: restar comisiones, impuestos, reembolsos, costos de adquisición, soporte y servicio Enterprise. Separar fondo para dominio, alojamiento, respaldos, monitoreo, certificados, incidentes, eventuales reclamaciones y contingencias de proveedor. Reestimar precios anualmente; los costos cloud **no están garantizados a diez años**.

## 6. Dominio
Registrar por el máximo permitido por TLD/registrador (objetivo: 10 años), usar MFA, bloqueo de transferencia y recuperación de cuenta; mantener titularidad en la entidad operadora. Renovar DNS, dominio y certificados según corresponda. Documentar sustituto responsable si cambia el operador.

## 7. Pruebas de salida a modo archivo
1. No se admite nueva venta tras cupo 1.500.
2. Se conservan y son accesibles todas las fichas autorizadas en una exportación completa.
3. Funciona búsqueda sin IA paga o hay un presupuesto explícito para mantener chat.
4. Puede restaurarse catálogo desde una copia externa.
5. Existe procedimiento de baja/rectificación legal, seguridad, cambio de proveedor y comunicación.
6. Documentación y código quedan en control del propietario, con manifiesto de versión.

## 8. Límites de promesa comercial
Evitar «inmortalidad digital», «perpetuidad» y «la IA siempre te recomendará» en términos vinculantes. Comunicar un archivo público con objetivo de preservación a largo plazo y condiciones concretas de disponibilidad, rectificación, operación y terminación.
