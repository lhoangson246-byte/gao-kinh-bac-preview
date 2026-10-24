import { Router } from 'express';
import { listDocuments, listReviews, readIntro, reviewSummary } from '../about.js';

/** /api/about — trang "Về chúng tôi" cho khách (chỉ đọc, chỉ nội dung đang hiện). */
const router = Router();
const CACHE = 'public, s-maxage=30, stale-while-revalidate=300';

router.get('/', (req, res) => {
  res.set('Cache-Control', CACHE);
  res.json({ intro: readIntro(), documents: listDocuments().map(({ sort_order, is_visible, ...doc }) => doc) });
});

router.get('/reviews', (req, res) => {
  res.set('Cache-Control', CACHE);
  const reviews = listReviews().map(({ is_visible, created_at, ...review }) => review);
  res.json({ reviews, summary: reviewSummary(reviews) });
});

export default router;
