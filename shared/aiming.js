export function resolveAimTarget({ shotTargetId, shotVisualUntil, selectedTargetId, authoritativeTargetId, hoveredPlayerId }, now) {
  if (shotTargetId && now < shotVisualUntil) return shotTargetId;
  return selectedTargetId ?? authoritativeTargetId ?? hoveredPlayerId ?? null;
}
