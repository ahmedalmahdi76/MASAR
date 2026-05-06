export default function Spinner({ size = 20 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      flexShrink: 0,
      border: '2px solid rgba(245,158,11,0.2)',
      borderTopColor: 'var(--masar-amber)',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}
