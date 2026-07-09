# Components V2 Footer Examples

Use `renderComponentsV2Panel` or `buildV2Container` from `bot/src/services/panelVisualRenderer.ts` for footer images in Components V2 panels.

## Panel with footer image

```ts
renderComponentsV2Panel({
  accentColor: 0xf2b84b,
  description: "Abra um atendimento abaixo.",
  footer: {
    image: "https://example.com/logo.png",
    text: "OrviteK Atendimento"
  },
  moduleId: "example-ticket",
  title: "Painel de Tickets"
});
```

## Panel without footer image

```ts
renderComponentsV2Panel({
  accentColor: 0x2563eb,
  description: "Mensagem sem imagem de rodape.",
  footer: {
    text: "OrviteK"
  },
  moduleId: "example-basic",
  title: "Painel Simples"
});
```

## Large image used as footer thumbnail

```ts
renderComponentsV2Panel({
  accentColor: 0x22c55e,
  description: "A imagem original pode ser grande; o rodape usa Thumbnail.",
  footer: {
    image: "https://example.com/1920x1080-banner.png",
    text: "OrviteK"
  },
  moduleId: "example-large-footer-image",
  title: "Imagem Grande no Rodape"
});
```

Footer images must not be sent as `MediaGallery`. The helper renders them as the last `Section` inside the `Container`, with `Thumbnail` as the accessory.
