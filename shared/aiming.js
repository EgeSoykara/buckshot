export function resolveAimTarget({ shotTargetId, shotVisualUntil, selectedTargetId, hoveredPlayerId }, now) {
  if (shotTargetId && now < shotVisualUntil) return shotTargetId;
  return selectedTargetId ?? hoveredPlayerId ?? null;
}
