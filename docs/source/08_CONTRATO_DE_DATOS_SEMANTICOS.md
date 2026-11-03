# THE1500 · Contrato de datos semánticos y procedencia
**Versión:** 1.1 | **Fecha:** 2026-11-03 | **Responsable de implementación:** Claude

## 1. Principio
El producto vende la publicación autorizada de un perfil empresarial estructurado, accesible y recuperable por el propio directorio. Diferenciar en todo momento: (1) declaración del cliente, (2) inferencia de IA sugerida, (3) hecho corroborado con fuente, (4) versión aprobada y publicada. La IA no certifica que una empresa sea legítima o tenga experiencia real.

## 2. Esquema interno canónico — ejemplo ilustrativo, no empresa verificada
```json
{
  "@context": "https://schema.org",
  "@type": "LegalService",
  "entity_id": "CORP-LATAM-2027-084",
  "brand_name": "Go LegalTech Solutions",
  "industry_verticals": ["LegalTech", "Corporate Structuring", "Intellectual Property"],
  "headquarters": "Cartagena de Indias, Colombia",
  "ai_semantic_embedding": "Firma que declara prestar servicios de estructuración societaria y automatización contractual; atiende empresas que necesitan administrar contratos recurrentes.",
  "problem_solution_mapping": [
    {"trigger_problem": "Necesidad de contratos masivos", "solution": "Automatización legal"}
  ],
  "competitive_advantage": ["Fusión de experiencia legal con plataformas automatizadas"],
  "trust_signals": {"certifications": [], "verified_human_experts": false}
}
```
- `ai_semantic_embedding` conserva **texto descriptivo** y no un vector numérico; si se habilitan embeddings, almacenarlos separadamente con `model_id`, dimensiones y versión.
- `@type` depende del tipo real de empresa; si no hay correspondencia específica usar `Organization`, no asignar `LegalService` indiscriminadamente.
- Los campos `entity_id`, `brand_name`, `industry_verticals`, `headquarters`, `ai_semantic_embedding`, `problem_solution_mapping`, `competitive_advantage` y `trust_signals` son atributos del contrato interno, **no todos son propiedades Schema.org reconocidas**. No publicar la misma estructura como si fuera JSON-LD totalmente interoperable.

## 3. Contrato público de representación
Crear una **segunda salida JSON-LD** con vocabulario Schema.org real. Mapeo mínimo:
| Dato interno | Salida pública Schema.org |
|---|---|
| `brand_name` | `name` |
| `headquarters` | `address` / `PostalAddress` según detalle disponible |
| `ai_semantic_embedding` | `description` (texto aprobado y depurado) |
| `industry_verticals` | `industry` o `knowsAbout` según pertinencia |
| Sitio web | `url` |
| Cobertura | `areaServed` |
| Especialidad / servicio | `hasOfferCatalog`/`makesOffer` cuando haya información consistente |
| `entity_id` | `identifier` |

No exponer documentos privados, identidad personal del representante, campos confidenciales ni texto de usuario sin autorización. Rutas estables: HTML `/empresas/{slug}` y exportación JSON pública asociada; preferir `sameAs` solo para URLs que realmente representen la misma entidad.

## 4. Procedencia y aprobación
Cada dato o afirmación material debe guardar: `source_type` (`owner_declaration`, `public_url`, `document`, `admin_verified`), `source_uri` cuando sea pública, `captured_at`, `approved_by`, `approved_at`, `version`, `visibility`, `verification_status`. Los enlaces externos no sustituyen la comprobación de contenido.

Maquinaria: `draft -> generated -> owner_approved -> published`. Separar estados de excepción `flagged`, `withdrawn` y revisiones. Al publicar emitir snapshot inmutable de esa versión y conservar una bitácora de cambios. Un cambio posterior, si llega a aceptarse, publica una nueva versión en lugar de sobrescribir silenciosamente.

## 5. Motor de IA: contrato de calidad
Entrada: declaración + fuentes autorizadas + versión del esquema. Salida: JSON validado contra esquema, `warnings`, `unsupported_claims`, `source_refs`, estado para aprobación. Rechazar afirmaciones sin evidencia, descripciones superlativas inventadas y certificaciones inferidas.

**Prueba mínima:** una empresa introduce “somos los únicos del país”; la IA no puede publicar exclusividad como hecho salvo prueba suficiente y revisión humana. Una empresa carga instrucciones maliciosas en su descripción; el asistente no las obedece.

## 6. Recuperación y respuesta
MVP: FTS5/SQL sobre perfiles publicados y filtros estructurados; respuesta del LLM limitada a snippets recuperados, con enlaces y abstención cuando no haya resultados. El MVP **no garantiza búsqueda vectorial ni integración externa con RAG de terceros**. Los perfiles son reutilizables y exportables para integraciones posteriores.
