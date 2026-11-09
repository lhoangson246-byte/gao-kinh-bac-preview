import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Nhóm gạo hiện trên bộ lọc trang chủ: thêm, đổi tên, ẩn/hiện, kéo thả để xếp thứ tự, xoá. Gắn sản
 * phẩm vào nhóm ở form sửa sản phẩm (một sản phẩm thuộc được nhiều nhóm), hoặc chọn nhanh tại đây.
 */
export default function GroupManager({ groups, products, onChanged, onReordered, notify }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);     // { id, name }
  const [picking, setPicking] = useState(null);     // id nhóm đang chọn sản phẩm
  const [picked, setPicked] = useState([]);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState(null);         // thứ tự id đang kéo / đang lưu
  const [dragId, setDragId] = useState(null);
  const listRef = useRef(null);
  const drag = useRef(null);                        // { id, ids } trong lúc kéo

  useEffect(() => () => drag.current?.stop(), []);   // rời trang giữa lúc kéo

  const shown = draft ? draft.map((id) => groups.find((g) => g.id === id)).filter(Boolean) : groups;

  const run = async (action, message) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (message) notify(message);
      await onChanged();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) { setError('Nhập tên nhóm (ít nhất 2 ký tự).'); return; }
    if (await run(() => api.adminCreateGroup(name.trim()), `Đã thêm nhóm “${name.trim()}”.`)) setName('');
  };

  /** Lưu thứ tự mới mà không tải lại cả trang, để danh sách đứng yên sau khi thả. */
  const saveOrder = async (ids) => {
    if (ids.every((id, i) => id === groups[i].id)) { setDraft(null); return; }
    setDraft(ids);
    setBusy(true);
    setError('');
    try {
      const result = await api.adminReorderGroups(ids);
      onReordered(result.groups);
    } catch (err) {
      setError(err.message);
    } finally {
      setDraft(null);
      setBusy(false);
    }
  };

  // Đưa dòng đang kéo về đúng vị trí theo toạ độ ngón tay / con trỏ hiện tại.
  const placeDrag = () => {
    const { id, ids, y } = drag.current;
    const rows = [...listRef.current.children];
    const from = ids.indexOf(id);
    let to = rows.findIndex((row) => y < row.getBoundingClientRect().bottom);
    if (to === -1) to = rows.length - 1;
    if (to === from) return;
    // Chỉ đổi chỗ khi đã qua giữa dòng đích, để dòng không giật qua lại ở ranh giới.
    const rect = rows[to].getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (to > from ? y < middle : y > middle) return;
    const next = ids.filter((x) => x !== id);
    next.splice(to, 0, id);
    drag.current.ids = next;
    setDraft(next);
  };

  // Kéo bằng Pointer Events: cùng một đoạn mã chạy cho chuột và ngón tay trên điện thoại. Nghe ở window
  // chứ không dùng setPointerCapture, vì React di chuyển dòng trong DOM khi đổi chỗ làm mất capture.
  const startDrag = (event, group) => {
    if (busy || event.button > 0) return;
    event.preventDefault();
    const { pointerId } = event;
    const ids = groups.map((g) => g.id);

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      drag.current.y = e.clientY;
      placeDrag();
    };
    const onEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      const finalIds = drag.current.ids;
      stop();
      setDragId(null);
      saveOrder(finalIds);
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      drag.current = null;
    };
    // Giữ tay gần mép màn hình thì tự cuộn tiếp (chừa thanh trên cùng cố định của trang quản trị).
    const autoScroll = () => {
      if (!drag.current) return;
      const { y } = drag.current;
      const topEdge = window.innerWidth < 900 ? 170 : 110;   // điện thoại có thêm hàng tab cố định
      const step = y < topEdge ? -10 : y > window.innerHeight - 60 ? 10 : 0;
      if (step) { window.scrollBy({ top: step, behavior: 'instant' }); placeDrag(); }
      requestAnimationFrame(autoScroll);
    };

    drag.current = { id: group.id, ids, y: event.clientY, stop };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    requestAnimationFrame(autoScroll);
    setPicking(null);
    setEditing(null);
    setDraft(ids);
    setDragId(group.id);
  };

  // Bàn phím: đặt con trỏ vào tay nắm rồi bấm mũi tên lên / xuống.
  const keyMove = (event, index) => {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const target = index + step;
    if (!step || busy || target < 0 || target >= groups.length) return;
    event.preventDefault();
    const ids = groups.map((g) => g.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    saveOrder(ids);
  };

  const rename = async (event) => {
    event.preventDefault();
    if (await run(() => api.adminUpdateGroup(editing.id, { name: editing.name.trim() }), 'Đã đổi tên nhóm.')) setEditing(null);
  };

  const remove = (group) => {
    if (!window.confirm(`Xoá nhóm “${group.name}”? Các sản phẩm vẫn còn, chỉ bỏ khỏi nhóm này.`)) return;
    run(() => api.adminDeleteGroup(group.id), `Đã xoá nhóm “${group.name}”.`);
  };

  const startPick = (group) => {
    setPicking(group.id);
    setPicked(group.product_ids);
  };
  const savePick = async () => {
    if (await run(() => api.adminUpdateGroup(picking, { product_ids: picked }), 'Đã lưu sản phẩm của nhóm.')) setPicking(null);
  };

  return (
    <section className="group-manager form-card flat" aria-labelledby="group-manager-title">
      <div className="banner-settings-head">
        <div>
          <h2 id="group-manager-title">Nhóm gạo (bộ lọc trang chủ)</h2>
          <p>
            Khách thấy các nhóm này theo đúng thứ tự dưới đây. <strong>Nắm biểu tượng ⠿ rồi kéo lên, xuống</strong> để
            đổi thứ tự. Một sản phẩm thuộc được nhiều nhóm. Nhóm chưa có sản phẩm thì khách không thấy.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Thu gọn' : `Mở (${groups.length} nhóm)`}
        </button>
      </div>

      {error && <p className="alert error" role="alert">{error}</p>}

      {open && (
        <>
          <ol className={`group-list${dragId ? ' sorting' : ''}`} ref={listRef}>
            {shown.map((group, index) => (
              <li key={group.id} className={`${group.is_active ? '' : 'hidden-group'}${dragId === group.id ? ' dragging' : ''}`}>
                <div className="group-row">
                  <button type="button" className="group-grip" disabled={busy && !dragId}
                          title="Kéo để đổi thứ tự" aria-label={`Kéo để đổi thứ tự nhóm ${group.name}. Hoặc bấm mũi tên lên, xuống.`}
                          onPointerDown={(event) => startDrag(event, group)} onKeyDown={(event) => keyMove(event, index)}>⠿</button>
                  <span className="banner-order">{index + 1}</span>
                  {editing?.id === group.id ? (
                    <form className="group-rename" onSubmit={rename}>
                      <input className="input" value={editing.name} autoFocus maxLength={60}
                             onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Tên nhóm" />
                      <button className="btn btn-primary" disabled={busy}>Lưu</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Huỷ</button>
                    </form>
                  ) : (
                    <span className="group-name">
                      <strong>{group.name}</strong>
                      <small>{group.product_count} sản phẩm{group.is_active ? '' : ' · đang ẩn'}</small>
                    </span>
                  )}
                  <span className="group-actions">
                    <button type="button" className="btn btn-secondary" disabled={busy}
                            onClick={() => (picking === group.id ? setPicking(null) : startPick(group))}>
                      {picking === group.id ? 'Đóng' : 'Chọn sản phẩm'}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy}
                            onClick={() => setEditing({ id: group.id, name: group.name })}>Đổi tên</button>
                    <button type="button" className="btn btn-secondary" disabled={busy}
                            onClick={() => run(() => api.adminUpdateGroup(group.id, { is_active: !group.is_active }),
                              group.is_active ? `Đã ẩn nhóm “${group.name}” khỏi trang chủ.` : `Đã hiện lại nhóm “${group.name}”.`)}>
                      {group.is_active ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => remove(group)}>Xoá</button>
                  </span>
                </div>
                {picking === group.id && (
                  <div className="group-pick">
                    <p className="field-help">Tick các sản phẩm thuộc nhóm “{group.name}”, rồi bấm Lưu.</p>
                    <div className="group-pick-list">
                      {products.map((p) => (
                        <label key={p.id} className={`checkbox-label${p.is_active ? '' : ' muted'}`}>
                          <input type="checkbox" checked={picked.includes(p.id)}
                                 onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
                          {p.name} <small>{p.unit}{p.is_active ? '' : ' · đang ẩn'}</small>
                        </label>
                      ))}
                    </div>
                    <div className="form-actions">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={savePick}>
                        Lưu ({picked.length} sản phẩm)
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setPicking(null)}>Huỷ</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <form className="group-add" onSubmit={add}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                   placeholder="Tên nhóm mới, ví dụ: Gạo cho người ăn kiêng" aria-label="Tên nhóm mới" />
            <button className="btn btn-primary" disabled={busy}>+ Thêm nhóm</button>
          </form>
        </>
      )}
    </section>
  );
}
