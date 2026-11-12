// The chat window, laid out like WhatsApp: a round 💬 button opens a panel with your
// chats (the global chat on top, then DMs and groups by latest message, unread counts),
// everyone who plays (online first, with Message / Add friend), and your friends (with
// requests to accept). Inside a chat: bubbles, times, who's online, a box to type in.

import { h, toast } from '../dom.js';
import { avatarBadge } from '../screens.js';
import { type Conversation, type Message, type Person, social } from './social.js';

type View = { kind: 'list'; tab: 'chats' | 'people' | 'friends' } | { kind: 'conv'; id: string } | { kind: 'new-group' } | { kind: 'group-info'; gid: string } | { kind: 'add-to-group'; gid: string };

const ROOM_NAMES: Record<string, string> = { lounge: 'in the Lounge', casino: 'in the Casino', arcade: 'in the Arcade' };

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

class ChatUi {
  private readonly fab = h('button', { class: 'chat-fab', 'aria-label': 'Chats', title: 'Chats and friends' }, '💬', h('span', { class: 'chat-fab-badge', hidden: true }));
  private readonly panel = h('aside', { class: 'chat-sheet', hidden: true, 'aria-label': 'Chats' });
  private view: View = { kind: 'list', tab: 'chats' };
  private search = '';
  private draft = new Map<string, string>();
  private picked = new Set<string>();
  private mounted = false;

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.fab.addEventListener('click', () => this.toggle());
    document.body.append(this.fab, this.panel);
    social.onChange(() => {
      this.badge();
      if (!this.panel.hidden) this.render(true);
    });
    social.onMessage((m) => this.incoming(m));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.close();
    });
    this.badge();
  }

  /** Shown on the walk-around rooms and the home page; hidden at the game tables. */
  setVisible(on: boolean): void {
    this.fab.hidden = !on;
    if (!on) this.close();
  }

  open(view?: View): void {
    if (view) this.view = view;
    this.panel.hidden = false;
    this.fab.classList.add('open');
    this.render();
  }

  close(): void {
    this.panel.hidden = true;
    this.fab.classList.remove('open');
  }

  private toggle(): void {
    if (this.panel.hidden) this.open();
    else this.close();
  }

  private badge(): void {
    const n = social.unreadTotal + social.friends.incoming.length;
    const b = this.fab.querySelector('.chat-fab-badge') as HTMLElement;
    b.hidden = n === 0;
    b.textContent = n > 99 ? '99+' : String(n);
  }

  private incoming(m: Message): void {
    if (m.from === social.uid) return;
    const viewing = !this.panel.hidden && this.view.kind === 'conv' && this.view.id === m.conv;
    if (viewing) {
      social.markRead(m.conv);
      return;
    }
    // Private and group messages pop up; the global chat just counts.
    if (m.conv !== 'global') toast(`💬 ${m.name}: ${m.text.slice(0, 80)}`);
  }

  // ---------- Rendering ----------

  private render(light = false): void {
    if (!social.available) {
      this.panel.replaceChildren(
        this.header('Chats'),
        h('div', { class: 'chat-empty' }, h('p', {}, 'Chats work in the game file, on the game website and on your own game server.'), h('p', { class: 'muted' }, 'This preview can’t reach the online service they use.')),
      );
      return;
    }
    const v = this.view;
    if (v.kind === 'conv') return this.renderConv(v.id, light);
    if (v.kind === 'new-group') return this.renderPicker('New group', null);
    if (v.kind === 'add-to-group') return this.renderPicker('Add people', v.gid);
    if (v.kind === 'group-info') return this.renderGroupInfo(v.gid);
    // Keep the search box focused while the list refreshes.
    const searching = document.activeElement?.classList.contains('chat-search');
    this.renderList(v.tab);
    if (searching) (this.panel.querySelector('.chat-search') as HTMLInputElement | null)?.focus();
  }

  private header(title: string, back?: () => void, extra?: HTMLElement | null, sub?: string): HTMLElement {
    return h(
      'header',
      { class: 'chat-head' },
      back ? h('button', { class: 'chat-back', 'aria-label': 'Back', onclick: back }, '←') : null,
      extra ?? null,
      h('div', { class: 'chat-head-text' }, h('b', {}, title), sub ? h('small', {}, sub) : null),
      h('button', { class: 'chat-x', 'aria-label': 'Close', onclick: () => this.close() }, '✕'),
    );
  }

  private renderList(tab: 'chats' | 'people' | 'friends'): void {
    const f = social.friends;
    const tabBtn = (t: typeof tab, label: string, count = 0) =>
      h('button', { class: `chat-tab${tab === t ? ' on' : ''}`, onclick: () => ((this.view = { kind: 'list', tab: t }), this.render()) }, label, count ? h('span', { class: 'tab-count' }, String(count)) : null);
    const body = h('div', { class: 'chat-body' });
    if (tab === 'chats') {
      body.append(
        h('button', { class: 'chat-new', onclick: () => ((this.picked = new Set()), (this.view = { kind: 'new-group' }), this.render()) }, '👥 New group'),
        ...social.conversations().map((c) => this.convRow(c)),
      );
      if (social.conversations().length === 1) body.append(h('p', { class: 'chat-hint muted' }, 'Start a private chat from People or Friends, or make a group.'));
    } else if (tab === 'people') {
      const q = h('input', { class: 'field chat-search', placeholder: 'Search players', value: this.search, 'aria-label': 'Search players' });
      q.addEventListener('input', () => {
        this.search = q.value;
        this.render();
      });
      const people = [...social.people.values()]
        .filter((p) => p.uid !== social.uid && p.name.toLowerCase().includes(this.search.trim().toLowerCase()))
        .sort((a, b) => Number(social.isOnline(b.uid)) - Number(social.isOnline(a.uid)) || b.at - a.at);
      const online = people.filter((p) => social.isOnline(p.uid)).length;
      body.append(q, h('p', { class: 'chat-section' }, `${online} online · ${people.length} players`), ...people.map((p) => this.personRow(p)));
      if (!people.length) body.append(h('p', { class: 'chat-hint muted' }, 'Nobody here yet. Invite friends to play!'));
    } else {
      if (f.incoming.length) {
        body.append(h('p', { class: 'chat-section' }, 'Friend requests'));
        for (const r of f.incoming) {
          const p = social.people.get(r.uid);
          body.append(
            h(
              'div',
              { class: 'chat-row' },
              p ? avatarBadge(p.look) : h('span', { class: 'chat-avatar' }, '👤'),
              h('div', { class: 'chat-row-text' }, h('b', {}, r.name), h('small', {}, 'wants to be your friend')),
              h('button', { class: 'btn gold tiny', onclick: () => social.answer(r.uid, true) }, 'Accept'),
              h('button', { class: 'btn ghost tiny', onclick: () => social.answer(r.uid, false) }, 'Decline'),
            ),
          );
        }
      }
      body.append(h('p', { class: 'chat-section' }, `Friends (${f.friends.length})`));
      const friends = f.friends.map((uid) => social.people.get(uid)).filter((p): p is Person => Boolean(p));
      friends.sort((a, b) => Number(social.isOnline(b.uid)) - Number(social.isOnline(a.uid)));
      body.append(...friends.map((p) => this.personRow(p)));
      if (!friends.length) body.append(h('p', { class: 'chat-hint muted' }, 'Find people in the People tab and tap “Add friend”.'));
      if (f.outgoing.length) body.append(h('p', { class: 'chat-hint muted' }, `Waiting for ${f.outgoing.length} ${f.outgoing.length === 1 ? 'person' : 'people'} to accept your request.`));
    }
    this.panel.replaceChildren(
      this.header('Chats'),
      h('nav', { class: 'chat-tabs' }, tabBtn('chats', 'Chats', social.unreadTotal), tabBtn('people', 'People'), tabBtn('friends', 'Friends', f.incoming.length)),
      body,
    );
  }

  private convRow(c: Conversation): HTMLElement {
    const icon = c.kind === 'global' ? h('span', { class: 'chat-avatar global' }, '🌍') : c.kind === 'group' ? h('span', { class: 'chat-avatar group' }, '👥') : c.look ? avatarBadge(c.look) : h('span', { class: 'chat-avatar' }, '👤');
    const online = c.kind === 'dm' && social.isOnline(c.id.slice(3));
    return h(
      'button',
      { class: 'chat-row', onclick: () => this.openConv(c.id) },
      h('span', { class: 'chat-avatar-wrap' }, icon, online ? h('i', { class: 'online-dot' }) : null),
      h(
        'div',
        { class: 'chat-row-text' },
        h('b', {}, c.title),
        h('small', {}, c.last ? `${c.last.from === social.uid ? 'You' : c.kind === 'dm' ? '' : c.last.name}${c.last.from === social.uid || c.kind !== 'dm' ? ': ' : ''}${c.last.text}` : c.kind === 'global' ? 'Say hi to everyone!' : 'No messages yet'),
      ),
      h('div', { class: 'chat-row-meta' }, c.last ? h('small', {}, clock(c.last.at)) : null, c.unread ? h('span', { class: 'unread' }, String(c.unread)) : null),
    );
  }

  private personRow(p: Person): HTMLElement {
    const state = social.friendState(p.uid);
    const online = social.isOnline(p.uid);
    return h(
      'div',
      { class: 'chat-row' },
      h('span', { class: 'chat-avatar-wrap' }, avatarBadge(p.look), online ? h('i', { class: 'online-dot' }) : null),
      h('div', { class: 'chat-row-text' }, h('b', {}, p.name, state === 'friend' ? h('span', { class: 'friend-tag' }, ' ★') : null), h('small', {}, online ? `online ${p.room ? ROOM_NAMES[p.room] ?? '' : 'at a table'}` : `last seen ${ago(p.at)}`)),
      h('button', { class: 'btn ghost tiny', onclick: () => this.openConv(social.startDm(p.uid)) }, 'Message'),
      state === 'friend'
        ? h('span', { class: 'chat-state' }, 'Friends')
        : state === 'sent'
          ? h('span', { class: 'chat-state' }, 'Requested')
          : state === 'asked-you'
            ? h('button', { class: 'btn gold tiny', onclick: () => social.answer(p.uid, true) }, 'Accept')
            : h('button', { class: 'btn gold tiny', onclick: () => (social.addFriend(p.uid), toast(`Friend request sent to ${p.name}`)) }, 'Add friend'),
    );
  }

  private openConv(id: string): void {
    this.view = { kind: 'conv', id };
    this.open();
    social.markRead(id);
  }

  private convTitle(id: string): { title: string; sub: string; icon: HTMLElement | null } {
    if (id === 'global') return { title: 'Everyone', sub: `${[...social.people.keys()].filter((u) => social.isOnline(u)).length} online · everyone can read this chat`, icon: h('span', { class: 'chat-avatar global' }, '🌍') };
    if (id.startsWith('dm:')) {
      const p = social.people.get(id.slice(3));
      return { title: p?.name ?? 'Player', sub: p ? (social.isOnline(p.uid) ? `online ${p.room ? ROOM_NAMES[p.room] ?? '' : ''}` : `last seen ${ago(p.at)}`) + ' · 🔒 encrypted' : '', icon: p ? avatarBadge(p.look) : null };
    }
    const g = social.groups.find((x) => `grp:${x.gid}` === id);
    const names = (g?.members ?? []).map((m) => (m === social.uid ? 'You' : social.people.get(m)?.name ?? 'Player'));
    return { title: g?.name ?? 'Group', sub: `${names.join(', ')} · 🔒 encrypted`, icon: h('span', { class: 'chat-avatar group' }, '👥') };
  }

  private renderConv(id: string, light: boolean): void {
    const msgs = social.messagesOf(id);
    const list = h('div', { class: 'chat-messages' });
    let lastDay = '';
    for (const m of msgs) {
      const d = new Date(m.at).toDateString();
      if (d !== lastDay) {
        lastDay = d;
        list.append(h('div', { class: 'chat-day' }, d === new Date().toDateString() ? 'Today' : new Date(m.at).toLocaleDateString()));
      }
      const mine = m.from === social.uid;
      list.append(
        h(
          'div',
          { class: `bubble${mine ? ' mine' : ''}` },
          !mine && id !== `dm:${m.from}` ? h('b', { class: 'bubble-name' }, m.name) : null,
          h('span', { class: 'bubble-text' }, m.text),
          h('small', { class: 'bubble-time' }, clock(m.at), mine ? ' ✓✓' : ''),
        ),
      );
    }
    if (!msgs.length) list.append(h('p', { class: 'chat-hint muted' }, id === 'global' ? 'Say hi to everyone who plays!' : 'No messages yet. Say hello!'));
    if (light && this.panel.querySelector('.chat-messages')) {
      const old = this.panel.querySelector('.chat-messages')!;
      const atBottom = old.scrollHeight - old.scrollTop - old.clientHeight < 60;
      old.replaceWith(list);
      if (atBottom) list.scrollTop = list.scrollHeight;
      social.markRead(id);
      return;
    }
    const t = this.convTitle(id);
    const input = h('input', { class: 'field chat-input-box', placeholder: 'Message', maxlength: 500, value: this.draft.get(id) ?? '', 'aria-label': 'Message' });
    input.addEventListener('input', () => this.draft.set(id, input.value));
    const form = h(
      'form',
      {
        class: 'chat-compose',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const text = input.value;
          if (!text.trim()) return;
          input.value = '';
          this.draft.delete(id);
          const err = await social.send(id, text);
          if (err) {
            toast(err, 'error');
            input.value = text;
          }
        },
      },
      input,
      h('button', { class: 'chat-send', type: 'submit', 'aria-label': 'Send' }, '➤'),
    );
    const info = id.startsWith('grp:') ? h('button', { class: 'chat-info', 'aria-label': 'Group info', onclick: () => ((this.view = { kind: 'group-info', gid: id.slice(4) }), this.render()) }, 'ⓘ') : null;
    const head = this.header(t.title, () => ((this.view = { kind: 'list', tab: 'chats' }), this.render()), t.icon, t.sub);
    if (info) head.insertBefore(info, head.lastChild);
    this.panel.replaceChildren(head, list, form);
    list.scrollTop = list.scrollHeight;
    social.markRead(id);
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }

  /** Pick people: for a new group, or to add to one. */
  private renderPicker(title: string, gid: string | null): void {
    const name = h('input', { class: 'field', placeholder: 'Group name', maxlength: 40, 'aria-label': 'Group name' });
    const group = gid ? social.groups.find((g) => g.gid === gid) : null;
    const candidates = [...new Set([...social.friends.friends, ...social.conversations().filter((c) => c.kind === 'dm').map((c) => c.id.slice(3))])]
      .filter((u) => !group?.members.includes(u))
      .map((u) => social.people.get(u))
      .filter((p): p is Person => Boolean(p));
    const rows = candidates.map((p) => {
      const box = h('input', { type: 'checkbox', checked: this.picked.has(p.uid) });
      box.addEventListener('change', () => (box.checked ? this.picked.add(p.uid) : this.picked.delete(p.uid)));
      return h('label', { class: 'chat-row pick' }, box, avatarBadge(p.look), h('div', { class: 'chat-row-text' }, h('b', {}, p.name), h('small', {}, social.isOnline(p.uid) ? 'online' : `last seen ${ago(p.at)}`)));
    });
    const go = h(
      'button',
      {
        class: 'btn gold big',
        onclick: async () => {
          if (gid) {
            await social.addToGroup(gid, [...this.picked]);
            this.view = { kind: 'group-info', gid };
          } else {
            const err = await social.createGroup(name.value, [...this.picked]);
            if (err) return toast(err, 'error');
            const g = social.groups.at(-1)!;
            this.view = { kind: 'conv', id: `grp:${g.gid}` };
          }
          this.render();
        },
      },
      gid ? 'Add to the group' : 'Create the group',
    );
    this.panel.replaceChildren(
      this.header(title, () => ((this.view = gid ? { kind: 'group-info', gid } : { kind: 'list', tab: 'chats' }), this.render())),
      h(
        'div',
        { class: 'chat-body' },
        gid ? null : name,
        h('p', { class: 'chat-section' }, 'Choose from your friends and chats'),
        ...rows,
        candidates.length ? null : h('p', { class: 'chat-hint muted' }, 'Add some friends first (People tab).'),
        go,
      ),
    );
  }

  private renderGroupInfo(gid: string): void {
    const g = social.groups.find((x) => x.gid === gid);
    if (!g) return void ((this.view = { kind: 'list', tab: 'chats' }), this.render());
    this.panel.replaceChildren(
      this.header(g.name, () => this.openConv(`grp:${gid}`), h('span', { class: 'chat-avatar group' }, '👥'), `${g.members.length} members`),
      h(
        'div',
        { class: 'chat-body' },
        h('button', { class: 'chat-new', onclick: () => ((this.picked = new Set()), (this.view = { kind: 'add-to-group', gid }), this.render()) }, '➕ Add people'),
        ...g.members.map((uid) => {
          const p = social.people.get(uid);
          return h('div', { class: 'chat-row' }, p ? avatarBadge(p.look) : h('span', { class: 'chat-avatar' }, '👤'), h('div', { class: 'chat-row-text' }, h('b', {}, uid === social.uid ? 'You' : p?.name ?? 'Player', uid === g.owner ? h('span', { class: 'friend-tag' }, ' · admin') : null), h('small', {}, social.isOnline(uid) ? 'online' : p ? `last seen ${ago(p.at)}` : '')));
        }),
        h('button', { class: 'btn ghost', onclick: () => confirm(`Leave “${g.name}”?`) && (social.leaveGroup(gid), (this.view = { kind: 'list', tab: 'chats' }), this.render()) }, 'Leave the group'),
      ),
    );
  }
}

export const chatUi = new ChatUi();
