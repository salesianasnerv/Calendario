// ─── Configuración de la Administración del calendario ───────────────────────
// Proyecto de Supabase «Acceso Microsoft 365» (el mismo del Control de baños, la Reserva de espacios y el PAC).
// El calendario en sí no necesita iniciar sesión: esto solo se usa en el apartado Administración.
window.APP_CONFIG = {
  supabaseUrl: "https://hblayjaknhfxieqbzrlq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGF5amFrbmhmeGllcWJ6cmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjg0ODEsImV4cCI6MjEwNjgwNDQ4MX0.K2iWyQAt9upNBXUhdZuV-Nle9fkCMYgQ6jTBBO0MluE",

  dominio: "salesianas.org",          // solo pueden entrar cuentas de este dominio
  dominiosExtra: ["salesianes.org"],  // otros dominios del mismo Microsoft 365 del colegio
};
