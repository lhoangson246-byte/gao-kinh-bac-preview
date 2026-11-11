import { useState } from 'react';
import { api } from '../api';
import useDragReorder from './useDragReorder.js';

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
  const sort = useDragReorder({
    ids: groups.map((g) => g.id),
    disabled: busy,
    onStart: () => { setPicking(null); setEditing(null); },
    onSave: async (ids) => {
      setBusy(true);
      setError('');
      try {
        const result = await api.adminReorderGroups(ids);
        onReordered(result.groups);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
  });
  const shown = sort.order.map((id) => groups.find((g) => g.id === id)).filter(Boolean);

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
          <ol className={`group-list${sort.dragId ? ' sorting' : ''}`} ref={sort.listRef}>
            {shown.map((group, index) => (
              <li key={group.id} className={`${group.is_active ? '' : 'hidden-group'}${sort.dragId === group.id ? ' dragging' : ''}`}>
                <div className="group-row">
                  <button type="button" className="group-grip" disabled={busy && !sort.dragId}
                          title="Kéo để đổi thứ tự" aria-label={`Kéo để đổi thứ tự nhóm ${group.name}. Hoặc bấm mũi tên lên, xuống.`}
                          onPointerDown={(event) => sort.start(event, group.id)} onKeyDown={(event) => sort.keyMove(event, group.id)}>⠿</button>
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
