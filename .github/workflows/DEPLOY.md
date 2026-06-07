# Como publicar o Bolão Copa 2026

## Pré-requisitos
- Git instalado
- Node.js 18+ instalado
- Conta no GitHub (carlosmarinho83-arch)

---

## Passo 1 — Criar repositório no GitHub

1. Acesse github.com → "New repository"
2. Nome: `bolao-copa-2026`
3. Visibilidade: **Public**
4. NÃO inicializa com README
5. Clica "Create repository"

---

## Passo 2 — Enviar os arquivos

Abra o terminal na pasta com os arquivos e rode:

```bash
git init
git add .
git commit -m "feat: bolão copa 2026 com firebase"
git branch -M main
git remote add origin https://github.com/carlosmarinho83-arch/bolao-copa-2026.git
git push -u origin main
```

---

## Passo 3 — Ativar GitHub Pages via Actions

No repositório GitHub:
1. Aba **Settings** → **Pages**
2. Source: **GitHub Actions**
3. Salva

O deploy roda automaticamente a cada `git push`.

---

## Passo 4 — Regras do Firestore

No Firebase Console → Firestore → Rules, cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Apostas: qualquer um pode criar/ler, só admin deleta (via app)
    match /bets/{betId} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if true; // restringir depois com Auth
    }
    // Resultados dos jogos: leitura pública, escrita pelo admin
    match /games/{gameId} {
      allow read: if true;
      allow write: if true; // restringir depois com Auth
    }
  }
}
```

---

## URL final

```
https://carlosmarinho83-arch.github.io/bolao-copa-2026/
```

Compartilha esse link no grupo e está pronto!
