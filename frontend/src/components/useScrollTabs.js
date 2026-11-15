import { useEffect, useRef } from 'react';

/**
 * Hàng tab cuộn ngang (thanh quản trị, thanh trang làm việc trên điện thoại): tab đang chọn tự cuộn vào
 * giữa khung nhìn, và khung ghi `data-more="left right"` để CSS làm mờ mép còn tab bị khuất.
 * Trả về ref gắn vào phần tử cuộn; `activeKey` đổi thì canh lại.
 */
export default function useScrollTabs(activeKey) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const update = () => {
      const more = [];
      if (box.scrollLeft > 4) more.push('left');
      if (box.scrollLeft + box.clientWidth < box.scrollWidth - 4) more.push('right');
      box.dataset.more = more.join(' ');
    };
    const active = box.querySelector('.active');
    if (active && box.scrollWidth > box.clientWidth) {
      const left = active.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
      box.scrollTo({ left: left - (box.clientWidth - active.offsetWidth) / 2 });
    }
    update();
    box.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { box.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [activeKey]);
  return ref;
}
