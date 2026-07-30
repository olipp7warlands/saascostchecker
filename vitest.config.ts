import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
      // Varios *.test.ts (RLS/permisos) crean orgs reales y llaman a RPCs
      // `security definer` NO acotadas por org_id (p.ej. evaluate_renewal_alerts(),
      // usada tanto por renewal-alerts.test.ts como por renewal-actions.test.ts)
      // contra la MISMA instancia de Supabase local. En paralelo (default de
      // Vitest, un worker por archivo), dos llamadas a esa misma función desde
      // archivos distintos compiten por el mismo índice de idempotencia —
      // quien corre primero "roba" las filas que el otro archivo esperaba
      // insertar, dejando su aserción de conteo en 0 en vez del valor
      // esperado. Encontrado al añadir approval-engine.test.ts (bloque 3.2a),
      // que cambió el timing lo suficiente para que esta carrera preexistente
      // aflorara en CI. Serializar los archivos evita la carrera sin tocar
      // ninguna de las RPCs (harían falta org_id en su firma para ser
      // realmente paralelizables, fuera de alcance de este fix).
      fileParallelism: false,
    },
  };
});
