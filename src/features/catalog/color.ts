// Hash simple determinista (mismo string -> mismo entero siempre) para
// derivar el color del fallback de <AppLogo> sin depender de red ni de un
// mapa de colores por marca.
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Saturación/luminosidad fijas: cualquier hue resultante mantiene contraste
// AA suficiente para texto blanco encima.
export function colorForName(name: string): string {
  const hue = hashString(name) % 360;
  return `hsl(${hue} 55% 40%)`;
}
