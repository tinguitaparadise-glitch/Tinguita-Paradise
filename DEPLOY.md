# Publicar na Vercel

1. Importe o repositório na Vercel (preset "Other"/Express; não precisa de comando de build).
2. Em **Settings > Environment Variables** crie estas variáveis (as mesmas do `.env` local):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Ligação do Supabase em **modo transação** (porta **6543**): `postgresql://postgres.ziyelqwdykcfbanemdfi:SENHA@aws-0-eu-west-1.pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | `https://ziyelqwdykcfbanemdfi.supabase.co` |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | chaves públicas do Supabase |
| `SESSION_SECRET` | texto longo e aleatório (assina o cookie do painel) |
| `PUBLIC_URL` | endereço do site, ex.: `https://tinguita-paradise.vercel.app` |
| `CALLMEBOT_APIKEY` ou `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` | opcional: aviso automático no WhatsApp |
| `WHATSAPP_NOTIFY_TO` | `244940637666` |

3. Faça **Redeploy** depois de guardar as variáveis.

Estrutura: `public/` é servida pela rede da Vercel (site, painel em `/admin/`, imagens, vídeo);
`server.js` é a API (`/api/*` e `/media/*`). As fotos enviadas pelo painel ficam na tabela `media` do Supabase.
