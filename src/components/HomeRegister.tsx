import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InventorySummary, Locale, PublicCompanyCard } from '../lib/contracts/api';
import { formatPosition, formatUsdCents } from '../ui/i18n';
import { countPositions, FIRST_PAID_POSITION, phaseOf, type PositionKind } from '../ui/register';

interface Props {
  lang?: Locale;
  stats: InventorySummary | null;
  businesses: PublicCompanyCard[];
  positionMap: string | null;
  retiredLabel: string;
}

const CYCLE_MS = 4200;
const PAGE_SIZE = 24;

function regionName(code: string, lang: Locale) {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

export default function HomeRegister({ lang = 'en', stats, businesses, positionMap, retiredLabel }: Props) {
  const es = lang === 'es';
  const prefix = es ? '/es' : '';
  const map = positionMap && positionMap.length === 1500 ? positionMap : null;
  const closed = stats?.salesMode === 'closed_archive';

  const [companies, setCompanies] = useState<Record<number, PublicCompanyCard>>(() =>
    Object.fromEntries(businesses.map((b) => [b.position, b]))
  );
  const published = useMemo(() => {
    if (!map) return businesses.map((b) => b.position);
    const list: number[] = [];
    for (let i = 0; i < map.length; i++) if (map[i] === 'p') list.push(i + 1);
    return list;
  }, [map, businesses]);
  const [selected, setSelected] = useState<number | null>(published[0] ?? null);
  const [lookup, setLookup] = useState('');
  const [held, setHeld] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  // The board never re-renders; the highlight is moved directly so one hover does not touch 1,500 elements.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || selected === null) return;
    const cell = board.querySelector(`[data-n="${selected}"]`);
    cell?.classList.add('is-selected');
    return () => cell?.classList.remove('is-selected');
  }, [selected]);

  // A company outside the first page is fetched from the public directory, which lists them by ascending position.
  useEffect(() => {
    if (selected === null || companies[selected] || !map || map[selected - 1] !== 'p') return;
    const page = Math.floor(published.indexOf(selected) / PAGE_SIZE) + 1;
    let live = true;
    fetch(`/api/v1/public/companies?page=${page}&lang=${lang}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ items: PublicCompanyCard[] }>) : null))
      .then((data) => {
        if (!live || !data) return;
        setCompanies((prev) => ({ ...prev, ...Object.fromEntries(data.items.map((b) => [b.position, b])) }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [selected, companies, map, published, lang]);

  // The one ambient motion on the page: the register shows its companies in turn, until someone takes over.
  useEffect(() => {
    const motionOk = window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches;
    const shown = published.filter((n) => companies[n]);
    if (!motionOk || held || shown.length < 2 || !heroRef.current) return;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(heroRef.current);
    const timer = setInterval(() => {
      if (!visible || document.hidden) return;
      setSelected((current) => shown[(shown.indexOf(current ?? -1) + 1) % shown.length] ?? null);
    }, CYCLE_MS);
    return () => {
      clearInterval(timer);
      observer.disconnect();
    };
  }, [published, companies, held]);

  // The page's fixed action bar on small screens takes over once the hero's own buttons scroll away.
  useEffect(() => {
    const buttons = ctaRef.current;
    const bar = document.querySelector('.mobile-cta');
    if (!buttons || !bar) return;
    const observer = new IntersectionObserver(([entry]) => {
      bar.classList.toggle('is-visible', !entry.isIntersecting);
    });
    observer.observe(buttons);
    return () => observer.disconnect();
  }, []);

  const pick = useCallback((target: EventTarget | null) => {
    const n = Number((target as HTMLElement | null)?.dataset?.n);
    if (n) setSelected(n);
  }, []);

  function step(direction: 1 | -1) {
    if (!published.length) return;
    setHeld(true);
    const at = published.indexOf(selected ?? -1);
    setSelected(published[(at + direction + published.length) % published.length]!);
  }

  function goTo(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(lookup);
    if (Number.isInteger(n) && n >= 1 && n <= 1500) {
      setHeld(true);
      setSelected(n);
    }
  }

  const board = useMemo(() => {
    const groups = stats?.phases ?? [];
    if (!map || !groups.length) return null;
    return groups.map((phase) => {
      const cells: React.ReactNode[] = [];
      for (let n = phase.firstPosition; n <= phase.lastPosition; n++) {
        const code = map[n - 1];
        const kind = code === 'a' && n < FIRST_PAID_POSITION ? 'r' : code;
        cells.push(<i key={n} className={`cell cell-${kind}`} data-n={n} />);
      }
      return (
        <div key={phase.phase} className={`board-phase board-phase-${phase.status}`}>
          <div className="board-phase-label">
            <span>
              {es ? 'Fase' : 'Phase'} {phase.phase}
            </span>
            <span className="board-range">
              {phase.firstPosition.toLocaleString(es ? 'de-DE' : 'en-US')}–{phase.lastPosition.toLocaleString(es ? 'de-DE' : 'en-US')}
            </span>
            <span className="board-price">{formatUsdCents(phase.priceUsdCents, lang).replace(' USD', '')}</span>
          </div>
          <div className="board-grid">{cells}</div>
        </div>
      );
    });
  }, [map, stats, es, lang]);

  const counts = map ? countPositions(map, stats?.phases ?? []) : null;

  const statusLine = (() => {
    if (!stats) return null;
    const current = stats.phases.find((p) => p.status === 'current');
    switch (stats.salesMode) {
      case 'selling':
        return current
          ? es
            ? `Fase ${current.phase} abierta: ${formatUsdCents(current.priceUsdCents, lang)} antes de impuestos.`
            : `Phase ${current.phase} is open: ${formatUsdCents(current.priceUsdCents, lang)} before tax.`
          : null;
      case 'awaiting_founder_allocation':
        return es
          ? 'Las posiciones en venta de la Fase 1 se agotaron. La Fase 2 abre cuando se asignen las reservadas.'
          : 'Phase 1 positions for sale are gone. Phase 2 opens once the reserved positions are allocated.';
      case 'premium_admission':
        return es
          ? 'Últimas 150 posiciones, por solicitud. Sin pago en línea.'
          : 'The final 150 positions, by application. No online checkout.';
      case 'closed_archive':
        return es ? 'Las 1.500 posiciones están asignadas. El directorio sigue abierto.' : 'All 1,500 positions are taken. The directory stays open.';
      default:
        return null;
    }
  })();

  function plate() {
    if (selected === null) {
      return (
        <p className="plate-text">
          {es ? 'Elige una posición para ver su estado.' : 'Pick a position to see its status.'}
        </p>
      );
    }
    const code = (map ? map[selected - 1] : 'p') as PositionKind;
    const phase = stats ? phaseOf(selected, stats.phases) : undefined;
    const company = companies[selected];
    if (code === 'p') {
      if (!company) return <p className="plate-text">{es ? 'Cargando empresa…' : 'Loading company…'}</p>;
      const isDemo = company.name.toLowerCase().startsWith('demo ');
      return (
        <>
          {isDemo && <span className="plate-demo">{es ? 'Empresa de demostración' : 'Demo company'}</span>}
          <h2 className="plate-name">{company.name}</h2>
          <p className="plate-meta">
            {[company.industry, regionName(company.country, lang)].filter(Boolean).join(', ')}
          </p>
          {company.summary && <p className="plate-text plate-clamp">{company.summary}</p>}
          <a className="plate-link" href={`${prefix}/empresas/${company.slug}`}>
            {es ? 'Ver perfil' : 'View profile'}
          </a>
        </>
      );
    }
    if (code === 'x') return <p className="plate-text plate-strong">{retiredLabel}</p>;
    if (code === 'o') {
      return (
        <p className="plate-text">
          {es
            ? 'Posición asignada. Su empresa todavía no ha publicado su perfil.'
            : 'This position is taken. Its company has not published a profile yet.'}
        </p>
      );
    }
    if (selected < FIRST_PAID_POSITION) {
      return (
        <p className="plate-text">
          {es
            ? 'Reservada para fundadores, por invitación. No está a la venta.'
            : 'Reserved for founders, by invitation. Not for sale.'}
        </p>
      );
    }
    if (!phase) return null;
    const price = formatUsdCents(phase.priceUsdCents, lang);
    if (phase.phase === 4) {
      return (
        <p className="plate-text">
          {es
            ? `Fase 4: ${price} antes de impuestos, por solicitud y revisión de una persona. Sin pago en línea.`
            : `Phase 4: ${price} before tax, by application and human review. No online checkout.`}
        </p>
      );
    }
    if (phase.status === 'current') {
      return (
        <p className="plate-text">
          {es
            ? `Disponible por ${price} antes de impuestos. Los números se asignan en orden al confirmarse el pago; no se eligen.`
            : `Available for ${price} before tax. Numbers are assigned in order when payment is confirmed; they cannot be chosen.`}
        </p>
      );
    }
    return (
      <p className="plate-text">
        {es
          ? `Abre con la Fase ${phase.phase} a ${price} antes de impuestos.`
          : `Opens with Phase ${phase.phase} at ${price} before tax.`}
      </p>
    );
  }

  return (
    <section ref={heroRef} className="reg-hero" aria-labelledby="reg-title">
      <div className="reg-intro">
        <h1 id="reg-title" className="reg-title">
          <span>{es ? '1.500 empresas.' : '1,500 companies.'}</span>
          <span>{es ? 'Ni una más.' : 'Never one more.'}</span>
        </h1>
        <div className="reg-pitch">
          <p>
            {es
              ? 'Cada empresa recibe una posición numerada y un perfil público que su titular aprueba, escrito para que tanto personas como software entiendan qué hace.'
              : 'Each company gets a numbered position and a public profile its owner approves, written so both people and software can tell what it does.'}
          </p>
          <div ref={ctaRef} className="reg-cta">
            {!closed && (
              <a className="button btn-lg" href={`${prefix}/unirse`}>
                {es ? 'Unirse a THE1500' : 'Join THE1500'}
              </a>
            )}
            <a className={closed ? 'button btn-lg' : 'btn-secondary btn-lg'} href={`${prefix}/empresas`}>
              {es ? 'Ver directorio' : 'View Directory'}
            </a>
          </div>
          {statusLine && <p className="reg-status">{statusLine}</p>}
        </div>
      </div>

      <div className="reg-stage">
        {board && (
          <div
            ref={boardRef}
            className="board"
            aria-hidden="true"
            onPointerOver={(e) => {
              if (e.pointerType === 'mouse' && (e.target as HTMLElement).dataset.n) {
                setHeld(true);
                pick(e.target);
              }
            }}
            onPointerLeave={() => setHeld(false)}
            onClick={(e) => {
              if ((e.target as HTMLElement).dataset.n) {
                setHeld(true);
                pick(e.target);
              }
            }}
          >
            {board}
          </div>
        )}

        <div className="reg-side">
          <div className="plate" aria-live={held ? 'polite' : 'off'}>
            {selected !== null && <div className="plate-number">{formatPosition(selected)}</div>}
            <div className="plate-body">{plate()}</div>
          </div>

          <div className="plate-controls">
            {published.length > 1 && (
              <div className="plate-steps">
                <button type="button" className="btn-secondary btn-sm" onClick={() => step(-1)}>
                  {es ? 'Anterior' : 'Previous'}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => step(1)}>
                  {es ? 'Siguiente' : 'Next'}
                </button>
              </div>
            )}
            <form className="plate-lookup" onSubmit={goTo}>
              <label htmlFor="position-lookup">{es ? 'Ir a la posición' : 'Go to position'}</label>
              <input
                id="position-lookup"
                type="number"
                inputMode="numeric"
                min={1}
                max={1500}
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="1–1500"
              />
              <button type="submit" className="btn-secondary btn-sm">
                {es ? 'Ver' : 'Show'}
              </button>
            </form>
          </div>

          {counts && (
            <ul className="legend">
              <li>
                <i className="cell cell-p" />
                <span>{es ? 'Perfil publicado' : 'Published profile'}</span>
                <b>{counts.published}</b>
              </li>
              <li>
                <i className="cell cell-o" />
                <span>{es ? 'Asignada, sin publicar' : 'Taken, not yet published'}</span>
                <b>{counts.taken}</b>
              </li>
              <li>
                <i className="cell cell-a is-open" />
                <span>{es ? 'En venta ahora' : 'For sale now'}</span>
                <b>{counts.forSale}</b>
              </li>
              <li>
                <i className="cell cell-r" />
                <span>{es ? 'Reservada para fundadores' : 'Reserved for founders'}</span>
                <b>{counts.reserved}</b>
              </li>
              <li>
                <i className="cell cell-a" />
                <span>{es ? 'Fases siguientes' : 'Later phases'}</span>
                <b>{counts.later}</b>
              </li>
              <li>
                <i className="cell cell-x" />
                <span>{es ? 'Retirada' : 'Retired'}</span>
                <b>{counts.retired}</b>
              </li>
            </ul>
          )}
        </div>
      </div>

      {counts && (
        <p className="sr-only">
          {es
            ? `Estado de las 1.500 posiciones: ${counts.published} con perfil publicado, ${counts.taken} asignadas sin publicar, ${counts.forSale} en venta ahora, ${counts.reserved} reservadas para fundadores, ${counts.later} en fases siguientes y ${counts.retired} retiradas.`
            : `Status of the 1,500 positions: ${counts.published} with a published profile, ${counts.taken} taken and not yet published, ${counts.forSale} for sale now, ${counts.reserved} reserved for founders, ${counts.later} in later phases and ${counts.retired} retired.`}
        </p>
      )}
    </section>
  );
}
