import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const mapsSearch = (text) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
const KIND = { wholesale: 'Khách buôn', order: 'Đã từng giao', saved: 'Sổ địa chỉ của khách' };

/**
 * Tìm khách / địa chỉ cho nhân viên giao hàng, kể cả khách không có đơn giao cho mình: gõ tên, số điện
 * thoại, địa chỉ hoặc mã khách buôn, chọn trong danh sách thả xuống, rồi gọi hoặc chỉ đường.
 */
export default function CustomerFinder() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);
  const boxRef = useRef(null);
  const term = q.trim();
  // Mục cuối luôn là "Tìm trên Google Maps", cho địa chỉ chưa có trong dữ liệu cửa hàng.
  const options = term.length >= 2 ? [...results, { kind: 'maps' }] : [];

  useEffect(() => {
    if (term.length < 2) { setResults([]); setLoading(false); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.deliverySearch(term, controller.signal)
        .then((d) => { setResults(d.results); setError(''); setActive(-1); })
        .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [term]);

  useEffect(() => {
    const close = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (option) => {
    if (option.kind === 'maps') { window.open(mapsSearch(term), '_blank', 'noopener'); setOpen(false); return; }
    setChosen(option);
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (!options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((i) => (i + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (event.key === 'Enter' && open && active >= 0) { event.preventDefault(); choose(options[active]); }
    else if (event.key === 'Escape') setOpen(false);
  };

  return (
    <section className="finder" ref={boxRef} aria-label="Tìm khách và địa chỉ">
      <label className="finder-label" htmlFor="finder-input">🔎 Tìm khách, địa chỉ để chỉ đường</label>
      <div className="finder-box">
        <input id="finder-input" className="input" type="search" value={q} autoComplete="off" spellCheck={false}
               placeholder="Tên, số điện thoại, địa chỉ hoặc mã KB…" role="combobox" aria-expanded={open && options.length > 0}
               aria-controls="finder-list" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `finder-opt-${active}` : undefined}
               onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
        {open && term.length >= 2 && (
          <ul id="finder-list" className="finder-list" role="listbox">
            {loading && !results.length && <li className="finder-empty">Đang tìm…</li>}
            {!loading && !results.length && !error && <li className="finder-empty">Không có khách nào khớp “{term}”.</li>}
            {error && <li className="finder-empty err">{error}</li>}
            {options.map((option, index) => (
              <li key={option.kind === 'maps' ? 'maps' : `${option.phone}-${option.address}`} id={`finder-opt-${index}`} role="option" aria-selected={active === index}
                  className={`finder-option${active === index ? ' active' : ''}${option.kind === 'maps' ? ' maps' : ''}`}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => choose(option)}>
                {option.kind === 'maps' ? <span>🗺️ Tìm “{term}” trên Google Maps</span> : (
                  <>
                    <span className="finder-name">
                      <strong>{option.company || option.name}</strong>
                      {option.code && <em>{option.code}</em>}
                      {option.map_url && <em className="finder-pin">📍 có định vị</em>}
                    </span>
                    <small>{option.company ? `${option.name} · ` : ''}{formatPhone(option.phone)}</small>
                    <small className="finder-address">{option.address || 'Chưa có địa chỉ'}</small>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {chosen && (
        <article className="finder-card">
          <header>
            <div>
              <h3>{chosen.company || chosen.name}</h3>
              <small>{KIND[chosen.kind]}{chosen.code ? ` · ${chosen.code}` : ''}{chosen.company ? ` · ${chosen.name}` : ''}{chosen.order_count ? ` · ${chosen.order_count} đơn` : ''}</small>
            </div>
            <button type="button" className="icon-close" aria-label="Đóng" onClick={() => setChosen(null)}>×</button>
          </header>
          <p className="delivery-address">🏠 {chosen.address || 'Chưa có địa chỉ'}</p>
          <div className="finder-actions">
            <a className="btn btn-secondary" href={`tel:${chosen.phone}`}>📞 Gọi {formatPhone(chosen.phone)}</a>
            {(chosen.map_url || chosen.address) && (
              <a className="btn btn-primary" href={chosen.map_url || mapsSearch(chosen.address)} target="_blank" rel="noopener noreferrer">
                🗺️ {chosen.map_url ? 'Chỉ đường tới định vị' : 'Tìm địa chỉ trên Google Maps'}
              </a>
            )}
          </div>
        </article>
      )}
    </section>
  );
}
