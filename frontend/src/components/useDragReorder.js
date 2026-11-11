import { useEffect, useRef, useState } from 'react';

/**
 * Kéo thả để xếp thứ tự một danh sách (chuột, ngón tay, hoặc mũi tên lên / xuống trên tay nắm).
 * Dùng Pointer Events và nghe ở window chứ không dùng setPointerCapture, vì React di chuyển dòng trong
 * DOM khi đổi chỗ làm mất capture. Các con trực tiếp của `listRef` phải đúng là các dòng, theo thứ tự.
 *
 *   ids      thứ tự hiện tại (đã lưu)
 *   onSave   async (idsMới) — lưu; tự xử lý lỗi. Trong lúc lưu danh sách vẫn hiện thứ tự mới.
 *   onStart  gọi khi bắt đầu kéo (ví dụ đóng các form đang mở)
 */
export default function useDragReorder({ ids, onSave, disabled = false, onStart }) {
  const listRef = useRef(null);
  const drag = useRef(null);            // { id, ids, y, stop } trong lúc kéo
  const [draft, setDraft] = useState(null);
  const [dragId, setDragId] = useState(null);

  useEffect(() => () => drag.current?.stop(), []);   // rời trang giữa lúc kéo

  const save = async (next) => {
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) { setDraft(null); return; }
    setDraft(next);
    try { await onSave(next); } finally { setDraft(null); }
  };

  // Đưa dòng đang kéo về đúng vị trí theo toạ độ ngón tay / con trỏ hiện tại.
  const place = () => {
    const { id, ids: current, y } = drag.current;
    const rows = [...listRef.current.children];
    const from = current.indexOf(id);
    let to = rows.findIndex((row) => y < row.getBoundingClientRect().bottom);
    if (to === -1) to = rows.length - 1;
    if (to === from) return;
    // Chỉ đổi chỗ khi đã qua giữa dòng đích, để dòng không giật qua lại ở ranh giới.
    const rect = rows[to].getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (to > from ? y < middle : y > middle) return;
    const next = current.filter((x) => x !== id);
    next.splice(to, 0, id);
    drag.current.ids = next;
    setDraft(next);
  };

  const start = (event, id) => {
    if (disabled || event.button > 0) return;
    event.preventDefault();
    const { pointerId } = event;

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      drag.current.y = e.clientY;
      place();
    };
    const onEnd = (e) => {
      if (e.pointerId !== pointerId) return;
      const finalIds = drag.current.ids;
      stop();
      setDragId(null);
      save(finalIds);
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
      if (step) { window.scrollBy({ top: step, behavior: 'instant' }); place(); }
      requestAnimationFrame(autoScroll);
    };

    drag.current = { id, ids, y: event.clientY, stop };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    requestAnimationFrame(autoScroll);
    onStart?.();
    setDraft(ids);
    setDragId(id);
  };

  // Bàn phím: đặt con trỏ vào tay nắm rồi bấm mũi tên lên / xuống.
  const keyMove = (event, id) => {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const index = ids.indexOf(id);
    const target = index + step;
    if (!step || disabled || index < 0 || target < 0 || target >= ids.length) return;
    event.preventDefault();
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  };

  return { listRef, order: draft || ids, dragId, start, keyMove };
}
