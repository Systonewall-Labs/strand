
<p align="center">
  strand
</p>
<p align="center">
  <i>Context that stays where work happens.</i>
  <br/>
  <img width="100%" alt="strand screenshot" src="./docs/assets/strand-screenshot.png">
</p>

---

Most teams lose context in three places at once. Decisions made in Slack disappear in the scroll. Docs in Notion go stale and disconnected from the work that created them. Tasks in Linear have no memory of why they exist.

Strand is a different bet: one place where a conversation, the decisions it produces, and the tasks it generates live together — permanently linked.

## What it is

Strand is built around four primitives:

**Strands** — a thread of work with a defined scope. Not a channel that lives forever. A strand opens when something needs to be worked on, and closes when it's resolved.

**Tasks** — created inside a strand, from the conversation that motivated them. A task always knows why it exists.

**Decisions** — the core primitive. Three fields:

- *What* — the decision itself, one sentence.
- *Why* — the reasoning, alternatives considered, trade-offs accepted.
- *How it went* — notes as the work evolves.

The first two fields are immutable by design. They are the historical record. You don't edit a past decision — you open a new strand if it changes.

**Wiki** — not a separate section. A view of all decisions across all strands, searchable, with the editable notes field inline. The wiki emerges from the work rather than being maintained separately.

## Inspiration

**[pi-mono](https://github.com/badlogic/pi-mono)** by [Mario Zechner](https://mariozechner.at) — a minimal coding agent built with a philosophy of deliberate restraint. Features that other agents bake in, pi leaves out — not as a limitation but as a position.

That philosophy translated directly into how Strand was designed. Every feature request gets the same question: does this belong in the core, or does its absence make the core stronger?

Decisions in Strand are designed with that friction in mind. The modal asks you to write the what and the why before you save. Both fields lock on save. That small amount of deliberate effort is the point — it forces the decision to be articulated, not just made.

## What Strand doesn't have

No general-purpose chat. Every strand has a defined scope — there is no #general, no #random. If something isn't work, it doesn't belong in a strand.

No project management. No sprints, no roadmaps, no velocity tracking, no story points. Tasks exist to capture work that came out of a conversation — nothing more.

---

## Tech Stack

- **Backend**: Node.js with Express
- **Database**: SQLite (via Prisma ORM)
- **Authentication**: Lucia Auth
- **Frontend**: HTML, CSS, vanilla JavaScript

## Prerequisites

- Node.js 20+
- pnpm (or npm)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Systonewall-Labs/strand
cd strand
```

2. Install dependencies:

```bash
pnpm install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Edit the `.env` file as needed:

```env
DATABASE_URL=file:./dev.db
NODE_ENV=development
PORT=3000
RESEND_API_KEY=your_resend_api_key_here
```

4. Generate Prisma Client and apply migrations:

```bash
npx prisma generate
npx prisma migrate deploy
```

## Running

### Development

```bash
pnpm start
```

The application will be available at `http://localhost:3000` (or the port configured in `.env`).

### Available scripts

- `pnpm start` - Start the server
- `pnpm dev` - Start the server (same as start)
- `pnpm migrate` - Create a new migration (development)
- `pnpm migrate:deploy` - Apply migrations (production)
- `pnpm generate` - Generate Prisma Client
- `pnpm test` - Run tests

## Project structure

```
strand/
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── migrations/        # Database migrations
├── public/
│   ├── css/              # Styles
│   ├── js/               # Frontend JavaScript
│   └── index.html        # Main page
├── server/
│   ├── auth.js           # Authentication configuration
│   └── index.js          # Express API
├── docs/                 # Additional documentation
├── .env.example          # Environment variables example
└── package.json          # Project dependencies
```

## Features

- **Workspaces**: Create and manage collaborative workspaces
- **Strands**: Discussion topics within workspaces
- **Messages**: Send messages with contextual card support
- **Tasks**: Create and track tasks associated with conversations
- **Decisions**: Document decisions made in conversations
- **Authentication**: Secure login/signup system with sessions

## Database

The project uses SQLite as database, which means:

- No database server installation required
- Data stored in local file (`dev.db` by default)
- Ideal for development and low/medium concurrency applications
- Easy backup (just copy the .db file)

## Contributing

Contributions are welcome! Please:

1. Fork the project
2. Create a branch for your feature (`git checkout -b feature/nova-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/nova-feature`)
5. Open a Pull Request

## Roadmap

- [ ] No AI assistant baked in. Pi can be invoked as a participant in a strand, responding in the conversation thread like any team member. It does not act autonomously. You call it, it responds, the response stays anchored to the context where it was asked.

## License

MIT
