import React, { useState } from 'react';
import type { ApiError, DirectoryResponse, InventorySummary, Locale, PublicCompanyCard, SearchResponse } from '../lib/contracts/api';
import { formatPosition, formatUsdCents } from '../ui/i18n';

interface RetiredItem {
  position: number;
  label: string;
  labelEs: string;
}

interface Props {
  lang?: Locale;
  stats: InventorySummary | null;
  initialBusinesses: PublicCompanyCard[];
  retiredItems: RetiredItem[];
}

export default function LiveDirectoryPreview({
  lang = 'en',
  stats,
  initialBusinesses,
  retiredItems,
}: Props) {
  const es = lang === 'es';

  const [searchQuery, setSearchQuery] = useState('');
  const [country, setCountry] = useState('');
  const [vertical, setVertical] = useState('');
  const [problemQuery, setProblemQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'retired'>('all');

  const [items, setItems] = useState<PublicCompanyCard[]>(initialBusinesses);
  const [matchedQuotes, setMatchedQuotes] = useState<Record<string, { field: string; quote: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute mini inventory metrics from real server stats
  const activePhaseObj = stats?.phases?.find((p) => p.phase === stats.currentPhase) || stats?.phases?.[0] || null;
  const nextPhaseObj = stats?.phases?.find((p) => p.phase === ((stats.currentPhase || 1) + 1)) || null;

  const hasDemoCompanies = items.some((c) => c.name.toLowerCase().startsWith('demo '));

  async function applyFilters(e?: React.FormEvent, overrides?: {
    q?: string;
    ctry?: string;
    vert?: string;
    prob?: string;
    st?: 'all' | 'published' | 'retired';
  }) {
    if (e) e.preventDefault();
    const q = (overrides?.q !== undefined ? overrides.q : searchQuery).trim();
    const ctry = (overrides?.ctry !== undefined ? overrides.ctry : country).trim();
    const vert = (overrides?.vert !== undefined ? overrides.vert : vertical).trim();
    const prob = (overrides?.prob !== undefined ? overrides.prob : problemQuery).trim();
    const st = overrides?.st !== undefined ? overrides.st : statusFilter;

    if (st === 'retired') {
      setItems([]);
      setMatchedQuotes({});
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If problem/use-case lexical query is provided, use /api/v1/public/search (fts5_lexical)
      if (prob) {
        const params = new URLSearchParams();
        params.set('query', `${prob}${q ? ` ${q}` : ''}`.trim().slice(0, 220));
        params.set('limit', '12');
        if (ctry) params.set('country', ctry);
        if (vert) params.set('industry', vert);
        params.set('lang', lang);

        const res = await fetch(`/api/v1/public/search?${params.toString()}`, {
          headers: { 'X-Locale': lang },
        });
        const data = await res.json();
        if (!res.ok) {
          setError((data as ApiError)?.error?.message || (es ? 'Error al consultar el índice.' : 'Failed to query index.'));
        } else {
          const sr = data as SearchResponse;
          const quotesMap: Record<string, { field: string; quote: string }> = {};
          const mapped: PublicCompanyCard[] = sr.items.map((it) => {
            if (it.evidence) {
              quotesMap[it.slug] = { field: it.evidence.field, quote: it.evidence.quote };
            }
            return {
              slug: it.slug,
              name: it.name,
              country: it.country,
              industry: it.industry,
              summary: it.summary,
              position: it.position,
            };
          });
          setMatchedQuotes(quotesMap);
          setItems(mapped);
        }
      } else {
        const params = new URLSearchParams();
        params.set('page', '1');
        if (q) params.set('query', q.slice(0, 100));
        if (ctry) params.set('country', ctry);
        if (vert) params.set('industry', vert.slice(0, 100));
        params.set('lang', lang);

        const res = await fetch(`/api/v1/public/companies?${params.toString()}`, {
          headers: { 'X-Locale': lang },
        });
        const data = await res.json();
        if (!res.ok) {
          setError((data as ApiError)?.error?.message || (es ? 'Error al cargar el directorio.' : 'Failed to load directory.'));
        } else {
          const dr = data as DirectoryResponse;
          setMatchedQuotes({});
          setItems(dr.items);
        }
      }
    } catch {
      setError(es ? 'No se pudo conectar con el servidor del directorio.' : 'Unable to reach the directory server.');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setSearchQuery('');
    setCountry('');
    setVertical('');
    setProblemQuery('');
    setStatusFilter('all');
    setMatchedQuotes({});
    setError(null);
    setItems(initialBusinesses);
  }

  return (
    <section
      id="live-directory-preview"
      className="home-section"
      aria-label={es ? 'Vista previa en vivo del directorio' : 'Live directory preview'}
    >
      {/* Section Heading Block (Component #7) */}
      <div className="section-heading-block">
        <div>
          <div className="eyebrow">{es ? 'PRUEBA DE PRODUCTO EN VIVO' : 'LIVE PRODUCT PROOF'}</div>
          <h2>{es ? 'Explora el índice' : 'Explore the index'}</h2>
          <p className="section-subheading">
            {es
              ? 'Una vista previa en vivo de cómo aparecen las empresas dentro de THE1500.'
              : 'A live preview of how companies appear inside THE1500.'}
          </p>
        </div>

        {hasDemoCompanies && (
          <div className="badge badge-amber mono" style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}>
            {es
              ? 'DATOS DEMO ACTIVOS · Perfiles de demostración etiquetados'
              : 'DEMO DATA ACTIVE · Sample profiles clearly labeled as Demo'}
          </div>
        )}
      </div>

      {/* Mini Inventory Component (Above Preview) */}
      <div className="mini-inventory-strip" aria-label={es ? 'Resumen rápido de inventario' : 'Mini inventory summary'}>
        <div className="mini-inv-item">
          <span className="mini-inv-label">{es ? 'Posiciones ocupadas' : 'Positions occupied'}</span>
          <strong className="mono">{stats ? `${stats.occupied} / ${es ? '1.500' : '1,500'}` : '—'}</strong>
        </div>
        <div className="mini-inv-item">
          <span className="mini-inv-label">{es ? 'Fase actual' : 'Current phase'}</span>
          <strong className="mono">
            {stats?.currentPhase ? `${es ? 'Fase' : 'Phase'} ${stats.currentPhase}` : '—'}
            {stats?.currentPriceUsdCents ? ` (${formatUsdCents(stats.currentPriceUsdCents, lang)})` : ''}
          </strong>
        </div>
        <div className="mini-inv-item">
          <span className="mini-inv-label">{es ? 'Siguiente precio' : 'Next price'}</span>
          <strong className="mono">
            {nextPhaseObj ? formatUsdCents(nextPhaseObj.priceUsdCents, lang) : es ? 'Fase final' : 'Final tier'}
          </strong>
        </div>
        <div className="mini-inv-item">
          <span className="mini-inv-label">{es ? 'Posiciones restantes en esta fase' : 'Remaining positions in this phase'}</span>
          <strong className="mono" style={{ color: 'var(--gold-primary)' }}>
            {activePhaseObj ? activePhaseObj.remaining : '—'}
          </strong>
        </div>
      </div>

      {/* Main Split Layout: Left Filters / Right Results Grid */}
      <div className="directory-preview-layout">
        {/* Left: Preview Controls / Filters (Component #10) */}
        <aside className="preview-filters-panel">
          <form onSubmit={(e) => applyFilters(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>
                {es ? 'Controles y filtros' : 'Preview controls'}
              </h3>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--gold-primary)',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {es ? 'Restablecer' : 'Reset'}
              </button>
            </div>

            <div>
              <label htmlFor="prev-search">{es ? 'Buscar empresa o palabra clave' : 'Search field'}</label>
              <input
                id="prev-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={es ? 'Nombre o resumen...' : 'Company name or summary...'}
              />
            </div>

            <div>
              <label htmlFor="prev-country">{es ? 'País' : 'Country'}</label>
              <select
                id="prev-country"
                value={country}
                onChange={(e) => {
                  const val = e.target.value;
                  setCountry(val);
                  applyFilters(undefined, { ctry: val });
                }}
              >
                <option value="">{es ? 'Todos los países' : 'All countries'}</option>
                <option value="US">United States (US)</option>
                <option value="CO">Colombia (CO)</option>
                <option value="MX">Mexico (MX)</option>
                <option value="ES">Spain (ES)</option>
                <option value="GB">United Kingdom (GB)</option>
              </select>
            </div>

            <div>
              <label htmlFor="prev-vertical">{es ? 'Vertical / Industria' : 'Vertical / Industry'}</label>
              <select
                id="prev-vertical"
                value={vertical}
                onChange={(e) => {
                  const val = e.target.value;
                  setVertical(val);
                  applyFilters(undefined, { vert: val });
                }}
              >
                <option value="">{es ? 'Todas las verticales' : 'All verticals'}</option>
                <option value="Ocean freight">Ocean freight</option>
                <option value="Accounting">Accounting</option>
                <option value="Legal services">Legal services</option>
                <option value="Cybersecurity">Cybersecurity</option>
                <option value="Packaging">Packaging</option>
                <option value="Staffing">Staffing</option>
                <option value="Services">Services</option>
              </select>
            </div>

            <div>
              <label htmlFor="prev-problem">
                {es ? 'Problema o caso de uso (Léxico FTS5)' : 'Problem / use-case search (Lexical FTS5)'}
              </label>
              <input
                id="prev-problem"
                type="search"
                value={problemQuery}
                onChange={(e) => setProblemQuery(e.target.value)}
                placeholder={es ? 'Ej. shipment visibility, tax filings...' : 'e.g. shipment visibility, cloud risk...'}
              />
            </div>

            <div>
              <label htmlFor="prev-status">{es ? 'Estado de posición' : 'Status filter'}</label>
              <select
                id="prev-status"
                value={statusFilter}
                onChange={(e) => {
                  const val = e.target.value as 'all' | 'published' | 'retired';
                  setStatusFilter(val);
                  applyFilters(undefined, { st: val });
                }}
              >
                <option value="all">{es ? 'Todos los estados públicos' : 'All public statuses'}</option>
                <option value="published">{es ? 'Publicados (Published)' : 'Published profiles'}</option>
                <option value="retired">{es ? 'Cupos retirados (Retired)' : 'Retired positions'}</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? (es ? 'Consultando índice…' : 'Querying index…') : es ? 'Aplicar filtros' : 'Apply filters'}
            </button>
          </form>
        </aside>

        {/* Right: Results Grid */}
        <div className="preview-results-area">
          {error && (
            <div className="notice notice-error" role="alert" style={{ marginTop: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span>{error}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => applyFilters()}>
                  {es ? 'Reintentar' : 'Retry'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="surface-card" style={{ margin: 0, textAlign: 'center', padding: '3rem 1.5rem' }}>
              <div className="mono" style={{ color: 'var(--gold-primary)', marginBottom: '0.5rem' }}>
                ● {es ? 'CARGANDO PERFILES ESTRUCTURADOS…' : 'LOADING STRUCTURED PROFILES…'}
              </div>
              <p className="muted" style={{ margin: '0 auto' }}>
                {es ? 'Consultando el índice en tiempo real.' : 'Querying the live directory index.'}
              </p>
            </div>
          ) : (
            <>
              {statusFilter !== 'retired' && items.length > 0 && (
                <div className="preview-cards-grid">
                  {items.slice(0, 6).map((company) => {
                    const isDemo = company.name.toLowerCase().startsWith('demo ');
                    const quoteInfo = matchedQuotes[company.slug];
                    const profileHref = `${es ? '/es' : ''}/empresas/${company.slug}`;
                    return (
                      <article key={company.slug} className="directory-card">
                        <div>
                          <div className="directory-card-top">
                            <span className="badge badge-gold mono">{formatPosition(company.position)}</span>
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              {isDemo && (
                                <span
                                  className="badge badge-amber mono"
                                  title={es ? 'Empresa de demostración' : 'Demonstration company'}
                                >
                                  DEMO
                                </span>
                              )}
                              <span className="badge badge-emerald">{es ? 'Publicado' : 'Published'}</span>
                            </div>
                          </div>

                          <h3 className="directory-card-title">
                            <a href={profileHref}>{company.name}</a>
                          </h3>

                          <div className="directory-card-meta">
                            <span>{company.industry || (es ? 'Servicios' : 'Services')}</span>
                            <span aria-hidden="true">·</span>
                            <span className="mono">{company.country}</span>
                          </div>

                          <p className="directory-card-summary">
                            {company.summary ||
                              (es
                                ? 'Perfil empresarial estructurado y aprobado por su titular.'
                                : 'Owner-approved structured semantic business profile.')}
                          </p>

                          {quoteInfo && (
                            <div className="directory-card-quote">
                              <span className="mono" style={{ color: 'var(--gold-primary)', fontWeight: 600 }}>
                                [{quoteInfo.field}]
                              </span>{' '}
                              "{quoteInfo.quote}"
                            </div>
                          )}
                        </div>

                        <div className="directory-card-footer">
                          <a href={profileHref} className="directory-card-cta">
                            <span>{es ? 'Ver perfil' : 'View profile'}</span>
                            <span aria-hidden="true">→</span>
                          </a>
                          <a
                            href={`/api/v1/public/companies/${company.slug}.json${es ? '?lang=es' : ''}`}
                            className="mono muted"
                            style={{ fontSize: '0.73rem', textDecoration: 'underline' }}
                          >
                            JSON-LD
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Retired Positions when statusFilter is 'all' or 'retired' */}
              {(statusFilter === 'retired' || (statusFilter === 'all' && !searchQuery && !country && !vertical && !problemQuery)) &&
                retiredItems.length > 0 && (
                  <div style={{ marginTop: statusFilter === 'retired' ? 0 : '1rem' }}>
                    {retiredItems.map((ret) => (
                      <div
                        key={ret.position}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.75rem 1rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(248, 113, 113, 0.06)',
                          border: '1px solid rgba(248, 113, 113, 0.24)',
                          marginBottom: '0.5rem',
                        }}
                      >
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>
                          {formatPosition(ret.position)}
                        </span>
                        <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                          {es ? ret.labelEs : ret.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

              {statusFilter !== 'retired' && items.length === 0 && !error && (
                <div className="surface-card" style={{ margin: 0, textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                  <h3 style={{ marginBottom: '0.4rem' }}>
                    {es ? 'Sin resultados para estos filtros' : 'No matching profiles found'}
                  </h3>
                  <p className="muted" style={{ margin: '0 auto 1rem auto' }}>
                    {es
                      ? 'Ningún perfil publicado coincide con los filtros seleccionados actualmente.'
                      : 'No owner-approved published profiles matched your active filter criteria.'}
                  </p>
                  <button type="button" className="btn-secondary btn-sm" onClick={handleReset}>
                    {es ? 'Limpiar filtros y ver todos' : 'Clear filters & show all'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Bottom CTA */}
          <div
            style={{
              marginTop: '1.35rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              {es
                ? 'Nota: Las empresas con prefijo "Demo" son perfiles de demostración para verificar el índice.'
                : 'Note: Companies prefixed with "Demo" are demonstration profiles showcasing the live structure.'}
            </span>
            <a className="btn-secondary" href={es ? '/es/empresas' : '/empresas'}>
              {es ? 'Ver Directorio Completo →' : 'View Full Directory →'}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
