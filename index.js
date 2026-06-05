import("./scripts/start-production.mjs").catch((error) => {
  console.error("[start] falha ao iniciar aplicacao:", error);
  process.exit(1);
});
