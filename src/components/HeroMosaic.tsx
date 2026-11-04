import React, { useEffect, useState } from 'react';
import type { InventorySummary, Locale, PublicCompanyCard } from '../lib/contracts/api';
import { formatPosition, formatUsdCents } from '../ui/i18n';

interface RetiredItem {
  position: number;
  label: string;
  labelEs: string;
}

interface Props {
  lang?: Locale;
  stats: InventorySummary | null;
  businesses: PublicCompanyCard[];
  retiredItems: RetiredItem[];
}

interface MosaicTile {
  position: number;
  name: string;
  country: string;
  vertical: string;
  status: 'Published' | 'Reserved' | 'Available' | 'Founder' | 'Premium' | 'Retired';
  slug?: string;
  isDemo?: boolean;
  summary?: string | null;
}

const STORY_MESSAGES_EN = [
  'Visibility is becoming algorithmic.',
  'If your company is not structured, it becomes easier to ignore.',
  'THE1500 turns company information into a semantic public profile.',
  'Only 1,500 companies will enter.',
  'The earlier you join, the lower the price.',
];

const STORY_MESSAGES_ES = [
  'La visibilidad empresarial se está volviendo algorítmica.',
  'Si tu empresa no está estructurada, es más fácil que pase desapercibida.',
  'THE1500 convierte la información de tu empresa en un perfil público semántico.',
  'Solo entrarán 1.500 empresas.',
  'Cuanto antes te unas, menor es el precio de acceso.',
];

export default function HeroMosaic({ lang = 'en', stats, businesses, retiredItems }: Props) {
  const es = lang === 'es';
  const messages = es ? STORY_MESSAGES_ES : STORY_MESSAGES_EN;

  const [storyIndex, setStoryIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hoveredTile, setHoveredTile] = useState<MosaicTile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener?.('change', handler);
      return () => mq.removeEventListener?.('change', handler);
    }
  }, []);

  useEffect(() => {
    if (isPaused || reducedMotion) return;
    const timer = setInterval(() => {
      setStoryIndex((prev) => (prev + 1) % messages.length);
    }, 3400);
    return () => clearInterval(timer);
  }, [isPaused, reducedMotion, messages.length]);

  // Build authentic mosaic tiles from real published companies + real inventory phases
  const tiles: MosaicTile[] = React.useMemo(() => {
    const list: MosaicTile[] = [];

    // 1. Real published companies from DB
    for (const b of businesses.slice(0, 7)) {
      list.push({
        position: b.position,
        name: b.name,
        country: b.country,
        vertical: b.industry || (es ? 'Servicios B2B' : 'B2B Services'),
        status: 'Published',
        slug: b.slug,
        isDemo: b.name.toLowerCase().startsWith('demo '),
        summary: b.summary,
      });
    }

    // 2. Real retired positions from DB (Decision 29: only number & exact label)
    for (const r of retiredItems.slice(0, 1)) {
      list.push({
        position: r.position,
        name: es ? r.labelEs : r.label,
        country: '—',
        vertical: es ? 'Consumido' : 'Consumed',
        status: 'Retired',
      });
    }

    // 3. Representative slot tiles across the 1,500 registry
    const sampleSlots: MosaicTile[] = [
      {
        position: 12,
        name: es ? 'Invitación Fundador' : 'Founder Slot',
        country: 'GLOBAL',
        vertical: es ? 'Tramo 1 · Invitación' : 'Phase 1 · Invitation',
        status: 'Founder',
      },
      {
        position: 108,
        name: stats?.held && stats.held > 0 ? (es ? 'Reserva activa (20m)' : 'Active Hold (20m)') : es ? 'Posición disponible' : 'Available Position',
        country: '—',
        vertical: es ? 'Tramo 1 ($100)' : 'Phase 1 ($100)',
        status: stats?.held && stats.held > 0 ? 'Reserved' : 'Available',
      },
      {
        position: 240,
        name: es ? 'Posición disponible' : 'Available Position',
        country: '—',
        vertical: es ? 'Tramo 1 ($100)' : 'Phase 1 ($100)',
        status: 'Available',
      },
      {
        position: 601,
        name: es ? 'Posición Tramo 2' : 'Phase 2 Position',
        country: '—',
        vertical: es ? 'Tramo 2 ($400)' : 'Phase 2 ($400)',
        status: 'Available',
      },
      {
        position: 1051,
        name: es ? 'Posición Tramo 3' : 'Phase 3 Position',
        country: '—',
        vertical: es ? 'Tramo 3 ($1,000)' : 'Phase 3 ($1,000)',
        status: 'Available',
      },
      {
        position: 1351,
        name: es ? 'Admisión Premium' : 'Premium Admission',
        country: 'GLOBAL',
        vertical: es ? 'Tramo 4 ($5,066)' : 'Phase 4 ($5,066)',
        status: 'Premium',
      },
      {
        position: 1500,
        name: es ? 'Posición Final #1500' : 'Final Position #1500',
        country: 'GLOBAL',
        vertical: es ? 'Tramo 4 ($5,066)' : 'Phase 4 ($5,066)',
        status: 'Premium',
      },
    ];

    for (const s of sampleSlots) {
      if (list.length < 12 && !list.some((x) => x.position === s.position)) {
        list.push(s);
      }
    }

    return list.slice(0, 12);
  }, [businesses, retiredItems, stats, es]);

  function statusBadgeStyle(status: MosaicTile['status']) {
    switch (status) {
      case 'Published':
        return { bg: 'rgba(52, 211, 153, 0.14)', border: 'rgba(52, 211, 153, 0.38)', color: '#34d399', label: es ? 'Publicado' : 'Published' };
      case 'Reserved':
        return { bg: 'rgba(251, 191, 36, 0.14)', border: 'rgba(251, 191, 36, 0.38)', color: '#fbbf24', label: es ? 'Reservado' : 'Reserved' };
      case 'Founder':
        return { bg: 'rgba(238, 198, 121, 0.14)', border: 'rgba(238, 198, 121, 0.38)', color: '#eec679', label: es ? 'Fundador' : 'Founder' };
      case 'Premium':
        return { bg: 'rgba(192, 132, 252, 0.14)', border: 'rgba(192, 132, 252, 0.38)', color: '#c084fc', label: 'Premium' };
      case 'Retired':
        return { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.32)', color: '#f87171', label: es ? 'Retirado' : 'Retired' };
      default:
        return { bg: 'rgba(96, 165, 250, 0.1)', border: 'rgba(96, 165, 250, 0.28)', color: '#60a5fa', label: es ? 'Disponible' : 'Available' };
    }
  }

  return (
    <section
      className={`hero-immersive ${isLoaded ? 'hero-loaded' : ''} ${reducedMotion ? 'hero-reduced-motion' : ''}`}
      aria-label={es ? 'Introducción a THE1500' : 'THE1500 Hero'}
    >
      {/* Subtle SVG Node Constellation Lines */}
      <svg
        className="hero-constellation-svg"
        viewBox="0 0 1200 700"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M120 140 L380 210 L680 130 L980 220 L1080 420 L820 540 L440 510 L180 390 Z"
          stroke="rgba(238, 198, 121, 0.1)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        <path
          d="M380 210 L820 540 M680 130 L440 510"
          stroke="rgba(96, 165, 250, 0.08)"
          strokeWidth="1"
        />
        <circle cx="380" cy="210" r="3" fill="rgba(238, 198, 121, 0.35)" />
        <circle cx="680" cy="130" r="3" fill="rgba(52, 211, 153, 0.35)" />
        <circle cx="980" cy="220" r="3" fill="rgba(238, 198, 121, 0.35)" />
        <circle cx="820" cy="540" r="3" fill="rgba(96, 165, 250, 0.35)" />
      </svg>

      <div className="hero-inner-grid">
        {/* Left / Center Primary Storytelling Column */}
        <div className="hero-copy-col">
          <div className="eyebrow">
            {es ? 'Un índice privado de 1.500 empresas' : 'A private index of 1,500 companies'}
          </div>

          <h1 className="hero-headline">
            {es
              ? 'Las empresas que mantienen su visibilidad en la era de la IA.'
              : 'The companies that stay visible in the AI era.'}
          </h1>

          <p className="hero-subheadline">
            {es
              ? 'THE1500 ayuda a las empresas a publicar perfiles públicos estructurados, descubribles por personas, legibles por sistemas y preparados para la nueva generación de herramientas de IA.'
              : 'THE1500 helps companies publish structured public profiles that are discoverable by people, readable by systems, and ready for the next generation of AI tools.'}
          </p>

          {/* Storytelling Text Rotator (Component #15) */}
          <div
            className="story-rotator"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            aria-live="polite"
          >
            <div className="story-rotator-header">
              <span className="mono story-step-counter">
                0{storyIndex + 1} / 0{messages.length}
              </span>
              <div className="story-dots" role="tablist" aria-label={es ? 'Mensajes clave' : 'Key insights'}>
                {messages.map((msg, idx) => (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    aria-selected={storyIndex === idx}
                    aria-label={msg}
                    className={`story-dot ${storyIndex === idx ? 'active' : ''}`}
                    onClick={() => setStoryIndex(idx)}
                  />
                ))}
              </div>
            </div>
            <p className="story-rotator-text">{messages[storyIndex]}</p>
          </div>

          {/* Primary & Secondary CTAs + Tertiary Sign-in */}
          <div className="hero-cta-group">
            <a className="button hero-cta-primary" href={es ? '/es/unirse' : '/unirse'}>
              {es ? 'Unirse a THE1500' : 'Join THE1500'}
            </a>
            <a className="btn-secondary hero-cta-secondary" href={es ? '/es/empresas' : '/empresas'}>
              {es ? 'Ver Directorio' : 'View Directory'}
            </a>
            <a className="hero-cta-tertiary" href={es ? '/es/login' : '/login'}>
              {es ? 'Iniciar sesión →' : 'Sign in →'}
            </a>
          </div>

          {/* Microcopy below CTAs */}
          <div className="hero-microcopy">
            <span>{es ? '1.500 posiciones vitalicias' : '1,500 lifetime positions'}</span>
            <span className="hero-dot-sep" aria-hidden="true">·</span>
            <span>{es ? 'Inglés como idioma principal, abierto globalmente' : 'English-first, globally open'}</span>
            <span className="hero-dot-sep" aria-hidden="true">·</span>
            <span>{es ? 'Perfil estructurado + página pública + JSON-LD' : 'Structured profile + public page + JSON-LD export'}</span>
          </div>
        </div>

        {/* Right Interactive Mosaic of Brand / Slot Tiles (Component #5) */}
        <div className="hero-mosaic-col" aria-label={es ? 'Mosaico interactivo de posiciones' : 'Interactive position mosaic'}>
          <div className="mosaic-header-bar">
            <span className="mono" style={{ fontSize: '0.73rem', color: 'var(--gold-primary)' }}>
              ● {es ? 'ÍNDICE EN VIVO · 1.500 POSICIONES' : 'LIVE INDEX MOSAIC · 1,500 SLOTS'}
            </span>
            <span className="mono muted" style={{ fontSize: '0.72rem' }}>
              {stats
                ? `${stats.occupied}/1500 ${es ? 'asignadas' : 'allocated'} · ${
                    stats.currentPriceUsdCents ? formatUsdCents(stats.currentPriceUsdCents, lang) : ''
                  }`
                : '1,500 total'}
            </span>
          </div>

          <div className="mosaic-grid">
            {tiles.map((tile, i) => {
              const badge = statusBadgeStyle(tile.status);
              const isSelected = hoveredTile?.position === tile.position;
              return (
                <div
                  key={tile.position}
                  className={`slot-tile ${isSelected ? 'slot-tile-active' : ''} slot-float-${(i % 3) + 1}`}
                  onMouseEnter={() => setHoveredTile(tile)}
                  onFocus={() => setHoveredTile(tile)}
                  tabIndex={0}
                >
                  <div className="slot-tile-top">
                    <span className="mono slot-tile-number">{formatPosition(tile.position)}</span>
                    <span
                      className="slot-tile-badge"
                      style={{
                        background: badge.bg,
                        border: `1px solid ${badge.border}`,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="slot-tile-name" title={tile.name}>
                    {tile.name}
                  </div>
                  <div className="slot-tile-meta">
                    <span>{tile.vertical}</span>
                    {tile.country !== '—' && <span className="mono">{tile.country}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hover / Active Tile Mini Inspector */}
          <div className="mosaic-inspector">
            {hoveredTile ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span className="mono" style={{ color: 'var(--gold-primary)', fontWeight: 700 }}>
                      {formatPosition(hoveredTile.position)}
                    </span>
                    <strong style={{ fontSize: '0.88rem' }}>{hoveredTile.name}</strong>
                    {hoveredTile.isDemo && (
                      <span className="badge badge-slate mono" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                        DEMO
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>
                    {hoveredTile.summary || `${hoveredTile.vertical} · ${hoveredTile.country}`}
                  </div>
                </div>
                {hoveredTile.slug ? (
                  <a
                    href={`${es ? '/es' : ''}/empresas/${hoveredTile.slug}`}
                    className="btn-secondary btn-sm"
                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.76rem' }}
                  >
                    {es ? 'Ver perfil →' : 'View profile →'}
                  </a>
                ) : hoveredTile.status === 'Available' ? (
                  <a
                    href={es ? '/es/unirse' : '/unirse'}
                    className="btn-primary btn-sm"
                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.76rem' }}
                  >
                    {es ? 'Unirse →' : 'Claim slot →'}
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: '0.79rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  {es
                    ? 'Pasa el cursor sobre cualquier bloque para inspeccionar su posición y estado en vivo.'
                    : 'Hover or tap any position tile to inspect its live status and structured metadata.'}
                </span>
                <span className="mono" style={{ color: 'var(--gold-primary)' }}>1–1500</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lower Proof Strip (Stat Chips — Component #4) */}
      <div className="hero-proof-strip" aria-label={es ? 'Métricas clave de THE1500' : 'THE1500 key proof metrics'}>
        <div className="stat-chip">
          <strong className="mono">1,500</strong>
          <span>{es ? '1.500 posiciones totales' : '1,500 total positions'}</span>
        </div>
        <div className="stat-chip">
          <strong className="mono">100</strong>
          <span>{es ? '100 invitaciones para fundadores' : '100 founder invitations'}</span>
        </div>
        <div className="stat-chip">
          <strong className="mono">4</strong>
          <span>{es ? '4 fases de acceso escalonado' : '4 access phases'}</span>
        </div>
        <div className="stat-chip">
          <strong className="mono">12m</strong>
          <span>{es ? '12 meses de publicación garantizada' : '12 months guaranteed publication'}</span>
        </div>
      </div>
    </section>
  );
}
