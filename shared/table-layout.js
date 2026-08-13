export const TABLE_PLAYER_SLOTS = 6;
export const SEAT_RADIUS = 5.75;
export const ITEM_TRAY_RADIUS = 4.55;
export const ITEM_TRAY_ANGLE_OFFSET = Math.PI / TABLE_PLAYER_SLOTS;
export const ITEM_TRAY_HALF_WIDTH = 1.41;
export const ITEM_TRAY_HALF_DEPTH = .5;
export const GUN_HALF_WIDTH = .42;

export function seatAngle(index) {
  return index / TABLE_PLAYER_SLOTS * Math.PI * 2 + Math.PI / 2;
}

export function itemTrayAngle(index) {
  return seatAngle(index) + ITEM_TRAY_ANGLE_OFFSET;
}

export function radialPoint(angle, radius) {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export function distanceFromAimLine(point, aimAngle) {
  return Math.abs(point.x * Math.sin(aimAngle) - point.z * Math.cos(aimAngle));
}

export function minimumGunTrayClearance() {
  let minimum = Infinity;
  for (let targetIndex = 0; targetIndex < TABLE_PLAYER_SLOTS; targetIndex += 1) {
    const aimAngle = seatAngle(targetIndex);
    for (let trayIndex = 0; trayIndex < TABLE_PLAYER_SLOTS; trayIndex += 1) {
      const tray = radialPoint(itemTrayAngle(trayIndex), ITEM_TRAY_RADIUS);
      const delta = aimAngle - itemTrayAngle(trayIndex);
      const projectedTrayExtent = ITEM_TRAY_HALF_WIDTH * Math.abs(Math.cos(delta)) + ITEM_TRAY_HALF_DEPTH * Math.abs(Math.sin(delta));
      minimum = Math.min(minimum, distanceFromAimLine(tray, aimAngle) - projectedTrayExtent - GUN_HALF_WIDTH);
    }
  }
  return minimum;
}
