/**
 * 추상적인 다섯 잎 꽃 문양. 특정 꽃(동백·홍매화 등)을 그리지 않는다 —
 * 사야카의 상징꽃은 아직 확정 캐논이 아니므로 UI 장식이 캐논처럼 보이지 않게 한다.
 */
export function Crest({ size = 20, title }: { size?: number; title?: string }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {petals.map((deg) => (
        <ellipse key={deg} cx="0" cy="-5.6" rx="3.6" ry="5.2" fill="currentColor" transform={`rotate(${deg})`} opacity="0.92" />
      ))}
      <circle cx="0" cy="0" r="2.3" fill="var(--paper, #ede6d8)" />
      <circle cx="0" cy="0" r="1" fill="currentColor" />
    </svg>
  );
}
