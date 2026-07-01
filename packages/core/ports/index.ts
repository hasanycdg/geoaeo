// The ports the core depends on. Adapters (apps/api/adapters/*) implement these;
// the core is wired to concrete implementations only at the composition root.
export * from "./platform";
export * from "./billing";
