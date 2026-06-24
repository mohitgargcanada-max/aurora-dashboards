# Sites Worker ESM starter

Use this starter for a static microsite, click counter, or simple internal UI whose state is browser-local. It has no dependencies and needs no `npm install`.

Build and validate it with tools already present in the Sites Linux environment:

```sh
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The deterministic build copies two source files into the required archive shape:

```text
dist/
├── .openai/
│   └── hosting.json
└── server/
    └── index.js
```

For simple static sites, package this shape:

```sh
tar -czf site.tar.gz dist
```

`dist/server/index.js` is an ES module with a default export containing `fetch(request, env, ctx)`. Edit `worker/index.js`, not the generated file under `dist/`.

## Runtime connectivity

Configure `AUTOMATION_BEARER_TOKEN` and `EODHD_API_TOKEN` as hosted secrets. Do not store either value in source files. The protected check below attempts validated Yahoo history first and reaches EODHD only when Yahoo fails or is incomplete:

```text
GET /api/connectivity?symbol=AAPL&expected_session=YYYY-MM-DD
Authorization: Bearer <AUTOMATION_BEARER_TOKEN>
```

The response reports provider, row count, latest session and fallback reason. It never returns credentials or upstream request URLs.
