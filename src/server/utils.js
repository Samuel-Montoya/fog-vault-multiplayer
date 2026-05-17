function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function normalize(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!len) return { x: 0, y: 0, len: 0 };
  return { x: dx / len, y: dy / len, len };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function lineIntersectsRect(ax, ay, bx, by, r) {
  if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
  const edges = [
    [r.x, r.y, r.x + r.w, r.y],
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x + r.w, r.y + r.h, r.x, r.y + r.h],
    [r.x, r.y + r.h, r.x, r.y]
  ];
  return edges.some(([x1, y1, x2, y2]) => segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y2));
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const ccw = (x1, y1, x2, y2, x3, y3) => (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1);
  return ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy);
}

function randItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

module.exports = {
  uid,
  clamp,
  dist,
  angleDiff,
  normalize,
  rectsOverlap,
  pointInRect,
  lineIntersectsRect,
  randItem
};
