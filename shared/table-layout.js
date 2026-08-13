export const TABLE_PLAYER_SLOTS = 6;
export const SEAT_RADIUS = 5.75;
export const ITEM_TRAY_RADIUS = 4.55;
export const ITEM_TRAY_ANGLE_OFFSET = Math.PI / TABLE_PLAYER_SLOTS;
export const ITEM_TRAY_HALF_WIDTH = 1.41;
export const ITEM_TRAY_HALF_DEPTH = .5;
export const GUN_HALF_WIDTH = .42;
export const FIRST_PERSON_CAMERA_RADIUS = 7.35;
export const FIRST_PERSON_CAMERA_HEIGHT = 1.72;
export const ITEM_PROP_RADIUS = .29;
export const ITEM_SLOT_POSITIONS = Object.freeze([
  Object.freeze([-.9, -.28]),
  Object.freeze([0, -.28]),
  Object.freeze([.9, -.28]),
  Object.freeze([-.5, .3]),
  Object.freeze([.5, .3])
]);

const PLAYER_SEAT_SLOTS = Object.freeze({
  1: Object.freeze([0]),
  2: Object.freeze([0, 3]),
  3: Object.freeze([0, 2, 4]),
  4: Object.freeze([0, 2, 3, 5]),
  5: Object.freeze([0, 1, 2, 3, 5]),
  6: Object.freeze([0, 1, 2, 3, 4, 5])
});

export function seatAngle(index) {
  return index / TABLE_PLAYER_SLOTS * Math.PI * 2 + Math.PI / 2;
}

export function itemTrayAngle(index) {
  return seatAngle(index) + ITEM_TRAY_ANGLE_OFFSET;
}

export function playerSeatSlot(playerIndex, playerCount) {
  const slots = PLAYER_SEAT_SLOTS[playerCount] ?? PLAYER_SEAT_SLOTS[TABLE_PLAYER_SLOTS];
  return slots[playerIndex] ?? playerIndex % TABLE_PLAYER_SLOTS;
}

export function playerSeatAngle(playerIndex, playerCount) {
  return seatAngle(playerSeatSlot(playerIndex, playerCount));
}

export function radialPoint(angle, radius) {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export function distanceFromAimLine(point, aimAngle) {
  return Math.abs(point.x * Math.sin(aimAngle) - point.z * Math.cos(aimAngle));
}

export function firstPersonViewForPlayer(playerIndex, playerCount) {
  const angle = playerSeatAngle(playerIndex, playerCount);
  const position = radialPoint(angle, FIRST_PERSON_CAMERA_RADIUS);
  const target = radialPoint(angle + Math.PI, 2.4);
  return {
    angle,
    position: { ...position, y: FIRST_PERSON_CAMERA_HEIGHT },
    target: { ...target, y: .05 }
  };
}

export function minimumItemSlotClearance() {
  let minimum = Infinity;
  for (let first = 0; first < ITEM_SLOT_POSITIONS.length; first += 1) {
    for (let second = first + 1; second < ITEM_SLOT_POSITIONS.length; second += 1) {
      const [firstX, firstZ] = ITEM_SLOT_POSITIONS[first];
      const [secondX, secondZ] = ITEM_SLOT_POSITIONS[second];
      minimum = Math.min(minimum, Math.hypot(firstX - secondX, firstZ - secondZ) - ITEM_PROP_RADIUS * 2);
    }
  }
  return minimum;
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
