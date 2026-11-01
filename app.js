(function () {
  'use strict';

  const D = window.MTT_DATA;
  const MODE = document.documentElement.dataset.mode; // solo | host | vote
  // The class session runs one short pair; the solo page is the full project.
  const pairs = MODE === 'solo' ? D.pairs : [D.livePair];
  const single = pairs.length === 1;
  const RELAY = 'https://ntfy.sh/' + D.topic;
  const SCALE_HINT = '1 is not at all, 5 is very much.';

  const app = document.getElementById('app');
  const stepsLabel = document.getElementById('steps');
  const liveStatus = document.getElementById('live-status');

  /* ---------- small DOM helper: text always goes in through textContent ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  /* ---------- state ---------- */
  const emptyAnswers = () => ({
    r1: pairs.map(() => ({ guess: null, a: null, b: null, skipped: false })),
    r2: pairs.map(() => ({ a: null, b: null })),
    r1Sent: false,
    r2Sent: false,
  });
  let answers = emptyAnswers();
  let stepIndex = 0;

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* votes still work without it */ } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to clean */ } },
  };

  const originText = (pair, side) => (pair.human === side ? 'human-made' : 'made by Suno');
  const sideLetter = (side) => side.toUpperCase();
  const clipLabel = (i, side) => (single ? 'Clip ' : 'Pair ' + (i + 1) + ', clip ') + sideLetter(side);
  const pairHeading = (i) => (single ? 'Listen: clip A, then clip B' : 'Round 1: pair ' + (i + 1) + ' of ' + pairs.length);
  const ROOM = "This room's";
  const fmt1 = (n) => (n === null ? 'n/a' : n.toFixed(1));
  const signed = (n, digits) => (n === null ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(digits));
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  /* ---------- audio ---------- */
  let audios = [];
  function stopAudio() {
    audios.forEach((a) => a.pause());
    audios = [];
  }
  function pauseOthers(current) {
    audios.forEach((a) => { if (a !== current) a.pause(); });
  }
  function clock(s) {
    const t = Math.max(0, Math.floor(s || 0));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function clipPlayer(pairIndex, side, alertBox, showPair) {
    const clip = pairs[pairIndex].clips[side];
    const name = (showPair ? 'pair ' + (pairIndex + 1) + ', ' : '') + 'clip ' + sideLetter(side);
    const seconds = clip.seconds;
    const audio = h('audio', { preload: 'metadata', src: clip.src });
    audios.push(audio);
    const label = h('span', null, 'Play ' + name);
    const button = h('button', { type: 'button', class: 'play' }, label);
    const progress = h('progress', { max: seconds, value: 0, 'aria-label': name + ' progress' });
    const time = h('span', { class: 'time' }, '0:00 / ' + clock(seconds));
    const bars = clip.peaks.map((p) => {
      const bar = h('i');
      bar.style.setProperty('--h', Math.max(0.06, p));
      return bar;
    });
    const wave = h('div', { class: 'wave', 'aria-hidden': 'true' }, bars);

    button.addEventListener('click', () => {
      if (audio.paused) {
        pauseOthers(audio);
        audio.play().catch((e) => { if (e.name !== 'AbortError' && alertBox) alertBox.textContent = name + ' could not play. Press play again.'; });
      } else {
        audio.pause();
      }
    });
    audio.addEventListener('play', () => { pauseOthers(audio); label.textContent = 'Pause ' + name; });
    audio.addEventListener('pause', () => { label.textContent = 'Play ' + name; });
    audio.addEventListener('ended', () => { label.textContent = 'Play ' + name; });
    audio.addEventListener('timeupdate', () => {
      const dur = audio.duration || seconds;
      progress.value = Math.min(seconds, audio.currentTime);
      time.textContent = clock(audio.currentTime) + ' / ' + clock(dur);
      const lit = Math.floor((audio.currentTime / dur) * bars.length);
      bars.forEach((bar, i) => bar.classList.toggle('on', i < lit));
    });
    audio.addEventListener('error', () => { if (alertBox) alertBox.textContent = name + ' could not load.'; });
    audio.addEventListener('playing', () => { if (alertBox && alertBox.textContent.startsWith(name + ' ')) alertBox.textContent = ''; });
    return h('div', { class: 'player' }, button, wave, h('span'), time, progress, audio);
  }

  function memoPlayer(pair, pairIndex) {
    if (!pair.memo) return null;
    const audio = h('audio', { class: 'memo', controls: true, preload: 'metadata', src: pair.memo, 'aria-label': 'Voice memo about ' + pair.name });
    audio.addEventListener('play', () => pauseOthers(audio));
    audios.push(audio);
    return h('div', { class: 'card' },
      h('h3', null, 'Voice memo'),
      audio,
      pair.transcript ? [h('h3', null, 'Transcript'), h('p', { class: 'transcript' }, pair.transcript)] : null);
  }

  /* ---------- form controls ---------- */
  function radioGroup({ name, legend, options, value, onChange, wide }) {
    return h('fieldset', { 'data-name': name },
      h('legend', null, legend),
      h('div', { class: 'opts' + (wide ? ' wide' : '') }, options.map((o) =>
        h('label', { class: 'opt' },
          h('input', {
            type: 'radio', name, value: o.value, required: true, checked: String(value) === String(o.value),
            onchange: () => onChange(o.value),
          }),
          h('span', null, o.label)))));
  }
  const ratingOptions = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
  const guessOptions = [{ value: 'a', label: 'Clip A' }, { value: 'b', label: 'Clip B' }];

  /* Next stays focusable while incomplete; pressing it moves to the first unanswered question. */
  function nextBar({ label, missing, onNext, hint, doneHint, extras }) {
    const hintEl = h('p', { id: 'next-hint', class: 'hint', role: 'status' });
    const button = h('button', { type: 'button', id: 'next', class: 'primary', 'aria-describedby': 'next-hint' }, label);
    function update() {
      const gaps = missing();
      button.setAttribute('aria-disabled', gaps.length ? 'true' : 'false');
      const text = gaps.length ? hint(gaps.length) : doneHint;
      if (hintEl.textContent !== text) hintEl.textContent = text;
    }
    button.addEventListener('click', () => {
      const gaps = missing();
      if (gaps.length) {
        const first = document.querySelector('fieldset[data-name="' + gaps[0] + '"] input');
        if (first) first.focus();
        return;
      }
      onNext();
    });
    update();
    return { update, el: h('div', { class: 'actions' }, button, extras, hintEl) };
  }

  /* ---------- step flow per mode ---------- */
  const flows = {
    solo: () => ['intro', ...pairs.map((_, i) => 'pair:' + i), ...pairs.map((_, i) => 'reveal:' + i), 'round2', 'results'],
    host: () => ['join', ...pairs.map((_, i) => 'pair:' + i), ...pairs.map((_, i) => 'reveal:' + i), 'round2', 'results', ...(D.pilot.notes.length ? ['pilot'] : []), 'made', 'question'],
    vote: () => ['vote-intro', ...pairs.map((_, i) => 'pair:' + i), 'vote-wait', 'round2', 'vote-done'],
  };
  const flow = flows[MODE]();

  function stepTitle(step) {
    const [kind, arg] = step.split(':');
    const n = Number(arg) + 1;
    return {
      intro: 'Start', join: 'Join on your phone', 'vote-intro': 'Vote',
      pair: pairHeading(Number(arg)),
      reveal: single ? 'The reveal' : 'Reveal: pair ' + n + ' of ' + pairs.length,
      round2: 'Round 2', results: 'Results', pilot: 'Beyond this room', made: 'How this was made', question: 'The question',
      'vote-wait': 'Waiting for the reveal', 'vote-done': 'Thank you',
    }[kind];
  }

  function go(index, keepFocus) {
    stopAudio();
    stepIndex = Math.max(0, Math.min(flow.length - 1, index));
    const step = flow[stepIndex];
    const [kind, arg] = step.split(':');
    app.replaceChildren(renderers[kind](Number(arg)));
    const title = stepTitle(step);
    document.title = title + ' - The Musical Turing Test';
    stepsLabel.textContent = 'Step ' + (stepIndex + 1) + ' of ' + flow.length;
    if (MODE === 'vote') store.set('mtt-vote', { answers, stepIndex, voter });
    if (MODE === 'host') refreshLive();
    if (!keepFocus) {
      const heading = app.querySelector('h2');
      if (heading) { heading.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    }
  }
  const next = () => go(stepIndex + 1);
  const back = () => go(stepIndex - 1);

  function stepSection(title, ...kids) {
    return h('section', { class: 'step' }, h('h2', { tabindex: '-1' }, title), kids);
  }
  function hostNav() {
    return h('div', { class: 'actions' },
      stepIndex > 0 ? h('button', { type: 'button', onclick: back }, 'Back') : null,
      stepIndex < flow.length - 1 ? h('button', { type: 'button', class: 'primary', onclick: next }, 'Next') : null,
      h('span', { class: 'hint' }, 'Arrow keys or a clicker work too.'));
  }

  /* ---------- screens ---------- */
  const renderers = {
    intro() {
      return stepSection('Can you hear who made it?',
        h('p', { class: 'lead' }, 'You will hear ' + pairs.length + ' pairs of 30-second instrumental clips. In each pair, an independent producer made one clip. Suno, an AI music generator, made the other from a short written prompt.'),
        h('p', null, 'Guess which clip is human and rate how much each one moves you. Then you find out what is behind them, and you rate them again.'),
        h('p', { class: 'muted' }, 'Use headphones or speakers. It takes about 8 minutes.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: next }, 'Start the test')));
    },

    join() {
      return stepSection('Can you hear who made it?',
        h('p', { class: 'lead' }, D.hook),
        h('div', { class: 'join' },
          qrCode(),
          h('div', { class: 'card' },
            h('p', { class: 'url' }, h('a', { href: 'https://' + D.voteUrlShort }, D.voteUrlShort)),
            h('p', null, 'Scan to vote from your seat. No login, and your answers are anonymous. The sound comes from the room.'),
            connectionLine())),
        h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: resetVotes }, 'Clear practice votes')),
        hostNav());
    },

    'vote-intro'() {
      return stepSection('Vote from your seat',
        h('p', { class: 'lead' }, 'Two short clips play in the room. An independent producer made one, and Suno, an AI music generator, made the other.'),
        h('p', null, 'Guess which clip is human and rate how much each one moves you. Your answers are anonymous.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: next }, 'Start')));
    },

    pair(i) {
      const title = pairHeading(i);
      const alertBox = h('p', { class: 'alert', role: 'alert' });
      if (MODE === 'host') {
        return stepSection(title,
          h('p', { class: 'lead' }, 'On your phone: which clip is human, and how much does each one move you?'),
          h('div', { class: 'sides' }, ['a', 'b'].map((side) => h('div', { class: 'side ' + side },
            h('h3', null, 'Clip ' + sideLetter(side)), clipPlayer(i, side, alertBox)))),
          alertBox,
          h('p', { class: 'big' }, 'Phones answered: ', h('span', { 'data-live': 'n1' }, '0')),
          connectionLine(),
          hostNav());
      }

      const a = answers.r1[i];
      const names = { guess: 'p' + i + '-human', a: 'p' + i + '-a-before', b: 'p' + i + '-b-before' };
      const missing = () => ['a', 'b', 'guess'].filter((k) => a[k] === null).map((k) => names[k]);
      const isLastPair = i === pairs.length - 1;
      const advance = () => {
        if (MODE === 'vote' && isLastPair) sendRound(1);
        next();
      };
      const bar = nextBar({
        label: isLastPair ? (MODE === 'vote' ? 'Send my answers' : 'See what was behind them') : 'Next pair',
        missing,
        onNext: advance,
        hint: (n) => 'Answer ' + n + (n === 1 ? ' more question' : ' more questions') + ' to continue.',
        doneHint: 'All answered. You can continue.',
        extras: i > 0 ? h('button', { type: 'button', onclick: back }, 'Back') : null,
      });
      const set = (key) => (value) => { a[key] = value; a.skipped = false; bar.update(); };

      const ratingFor = (side) => radioGroup({
        name: names[side],
        legend: 'How much does clip ' + sideLetter(side) + ' move you? ' + SCALE_HINT,
        options: ratingOptions, value: a[side], onChange: (v) => set(side)(Number(v)),
      });

      return stepSection(title,
        h('p', null, MODE === 'vote' ? 'Listen to the room, then answer.' : 'Listen to both clips, then answer.'),
        h('div', { class: 'sides' }, ['a', 'b'].map((side) => h('div', { class: 'side ' + side },
          h('h3', null, 'Clip ' + sideLetter(side)),
          MODE === 'solo' ? clipPlayer(i, side, alertBox) : null,
          ratingFor(side)))),
        h('div', { class: 'guess' }, radioGroup({
          name: names.guess, legend: 'Which clip is human-made?', options: guessOptions,
          value: a.guess, onChange: set('guess'), wide: true,
        })),
        alertBox,
        bar.el,
        h('button', {
          type: 'button', class: 'link',
          onclick: () => { a.skipped = true; a.guess = a.a = a.b = null; advance(); },
        }, "Can't listen? Skip this pair"));
    },

    reveal(i) {
      const pair = pairs[i];
      const sunoSide = pair.human === 'a' ? 'b' : 'a';
      const title = (single ? 'Clip ' : 'Pair ' + (i + 1) + ': clip ') + sideLetter(pair.human) + ' was human-made, clip ' + sideLetter(sunoSide) + ' was made by Suno';
      let verdict;
      if (MODE === 'host') {
        verdict = h('p', { class: 'big' }, h('span', { 'data-live': 'right' + i }, '0 of 0'), ' found the human');
      } else if (answers.r1[i].skipped) {
        verdict = h('p', { class: 'lead' }, 'You skipped this pair.');
      } else {
        const guess = answers.r1[i].guess;
        verdict = h('p', { class: 'lead' }, 'Your guess: clip ' + sideLetter(guess) + '. ' + (guess === pair.human ? 'Correct.' : 'Incorrect.'));
      }

      // The memo and its transcript only play on the solo page, so everywhere else the words show here.
      const storyText = MODE === 'solo' && pair.memo ? pair.story : pair.story || pair.transcript;
      const humanFacts = h('div', { class: 'card' },
        h('h3', null, 'Clip ' + sideLetter(pair.human) + ': the producer'),
        pair.clock ? [
          h('p', { class: 'big' }, pair.clock),
          h('p', { class: 'muted' }, 'FL Studio project clock: how long this project was open.')] : null,
        h('dl', null,
          h('dt', null, 'Track'), h('dd', null, pair.name + ', ' + pair.bpm + ' BPM'),
          pair.credit ? [h('dt', null, 'Made by'), h('dd', null, pair.credit)] : null,
          pair.created ? [h('dt', null, 'Started'), h('dd', null, pair.created)] : null,
          pair.sounds ? [h('dt', null, 'Sounds loaded'), h('dd', null, pair.sounds)] : null),
        storyText ? h('p', null, storyText) : null);

      const sunoFacts = h('div', { class: 'card' },
        h('h3', null, 'Clip ' + sideLetter(sunoSide) + ': Suno'),
        pair.suno_time ? [
          h('p', { class: 'big' }, pair.suno_time),
          h('p', { class: 'muted' }, 'To generate' + (pair.suno_takes ? ', picked from ' + pair.suno_takes + ' takes.' : '.'))] : null,
        h('p', { class: 'muted' }, 'The whole input:'),
        h('p', { class: 'prompt' }, pair.prompt));

      return stepSection(title,
        verdict,
        h('div', { class: 'versus' }, pair.human === 'a' ? [humanFacts, sunoFacts] : [sunoFacts, humanFacts]),
        MODE === 'solo' ? memoPlayer(pair, i) : null,
        pair.screenshot ? h('figure', { class: 'card' },
          h('img', { class: 'shot', src: pair.screenshot, alt: pair.screenshot_alt || 'FL Studio project screenshot for ' + pair.name }),
          h('figcaption', null, 'The ' + pair.name + ' project in FL Studio.')) : null,
        MODE === 'host' ? hostNav() : h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: next },
          i === pairs.length - 1 ? 'Rate them again' : 'Next pair')));
    },

    round2() {
      const title = 'Round 2: now you know who made them';
      const alertBox = h('p', { class: 'alert', role: 'alert' });
      if (MODE === 'host') {
        return stepSection(title,
          h('p', { class: 'lead' }, 'On your phone: rate both clips again, now that you know who made them.'),
          h('p', { class: 'big' }, 'Phones rated again: ', h('span', { 'data-live': 'n2' }, '0')),
          connectionLine(),
          hostNav());
      }

      const active = pairs.map((_, i) => i).filter((i) => !answers.r1[i].skipped);
      const nameOf = (i, side) => 'p' + i + '-' + side + '-after';
      const missing = () => active.flatMap((i) => ['a', 'b']
        .filter((side) => answers.r2[i][side] === null)
        .map((side) => nameOf(i, side)));
      const bar = nextBar({
        label: MODE === 'vote' ? 'Send my answers' : 'See my results',
        missing,
        onNext: () => { if (MODE === 'vote') sendRound(2); next(); },
        hint: (n) => 'Answer ' + n + (n === 1 ? ' more question' : ' more questions') + ' to continue.',
        doneHint: 'All answered. You can continue.',
      });
      return stepSection(title,
        h('p', null, !active.length ? 'You skipped every pair, so there is nothing to rate here.'
          : MODE === 'vote' ? 'Rate each clip again, now that you know its origin.' : 'Listen again if you want to, and rate each clip now that you know its origin.'),
        active.map((i) => h('div', { class: 'sides' }, ['a', 'b'].map((side) => h('div', { class: 'side ' + side },
          h('h3', null, clipLabel(i, side)),
          MODE === 'solo' ? clipPlayer(i, side, alertBox, true) : null,
          radioGroup({
            name: nameOf(i, side),
            legend: clipLabel(i, side) + ' was ' + originText(pairs[i], side) + '. How much does it move you now? ' + SCALE_HINT,
            options: ratingOptions, value: answers.r2[i][side],
            onChange: (v) => { answers.r2[i][side] = Number(v); bar.update(); },
          }))))),
        alertBox,
        bar.el);
    },

    results() {
      return MODE === 'host' ? hostResults() : soloResults();
    },

    pilot() {
      return stepSection('Beyond this room',
        h('p', { class: 'lead' }, D.pilot.people + ' people took the full three-pair version. These are notes from talking to them, not findings.'),
        h('ul', { class: 'notes' }, D.pilot.notes.map((note) => h('li', null, note))),
        hostNav());
    },

    made() {
      return stepSection('How this was made',
        h('div', { class: 'versus' },
          h('div', { class: 'card' }, h('h3', null, 'With AI'), h('ul', { class: 'notes' }, D.with_ai.map((line) => h('li', null, line)))),
          h('div', { class: 'card' }, h('h3', null, 'Without AI'), h('ul', { class: 'notes' }, D.without_ai.map((line) => h('li', null, line))))),
        hostNav());
    },

    question() {
      return stepSection('The question stays open',
        h('p', { class: 'question' }, D.question),
        h('p', { class: 'lead' }, 'The Turing Test asks whether something passes as human. It can\'t tell us what, if anything, is missing when it does.'),
        h('p', null, 'Try the full three-pair version: ', h('a', { href: D.site }, D.site.replace('https://', ''))),
        hostNav());
    },

    'vote-wait'() {
      return stepSection('Waiting for the reveal',
        sendStatus(1),
        h('p', { class: 'lead' }, 'Follow the reveal on the main screen. The presenter also reads it aloud. Come back here when round 2 starts.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: next }, 'Start round 2')));
    },

    'vote-done'() {
      return stepSection('Thank you',
        sendStatus(2),
        h('p', { class: 'lead' }, 'The class results are on the main screen, and the presenter reads them aloud.'),
        h('button', {
          type: 'button', class: 'link',
          onclick: () => { store.del('mtt-vote'); answers = emptyAnswers(); go(0); },
        }, 'Start over'));
    },
  };

  /* Dark modules on a white panel in both themes. If the library can't load, the typed URL beside it still works. */
  function qrCode() {
    if (typeof window.qrcode !== 'function') return null;
    const qr = window.qrcode(0, 'M');
    qr.addData('https://' + D.voteUrlShort);
    qr.make();
    const size = qr.getModuleCount();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for the voting page: ' + D.voteUrlShort);
    svg.setAttribute('shape-rendering', 'crispEdges');
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.isDark(y, x)) path += 'M' + x + ' ' + y + 'h1v1h-1z';
      }
    }
    const shape = document.createElementNS(NS, 'path');
    shape.setAttribute('d', path);
    shape.setAttribute('fill', '#000000');
    svg.append(shape);
    return h('div', { class: 'qr' }, svg);
  }

  /* ---------- results ---------- */
  function changeRows(getBefore, getAfter) {
    return pairs.flatMap((pair, i) => ['a', 'b'].map((side) => {
      const before = getBefore(i, side);
      const after = getAfter(i, side);
      return {
        key: 'p' + i + side, pairIndex: i, side, before, after,
        origin: pair.human === side ? 'Human' : 'Suno',
        label: clipLabel(i, side),
        change: before === null || after === null ? null : after - before,
      };
    }));
  }

  function shiftChart(rows, caption) {
    const x = (v) => ((v - 1) / 4) * 100;
    return h('figure', null,
      h('div', { 'aria-hidden': 'true' },
        h('div', { class: 'legend' },
          h('span', null, h('i', { class: 'dot' }), 'Before the reveal'),
          h('span', null, h('i', { class: 'dot after' }), 'After the reveal')),
        h('div', { class: 'rows', 'data-chart': 'rows' }, rows.map((r) => chartRow(r, x))),
        h('div', { class: 'axis' }, [1, 2, 3, 4, 5].map((n) => h('span', null, n)))),
      h('figcaption', null, caption + ' Exact values are in the table below.'));
  }

  function chartRow(r, x) {
    const track = h('div', { class: 'track' }, [1, 2, 3, 4, 5].map((n) => {
      const tick = h('i', { class: 'tick' });
      tick.style.left = x(n) + '%';
      return tick;
    }));
    if (r.before !== null && r.after !== null) {
      const line = h('i', { class: 'span' });
      line.style.left = Math.min(x(r.before), x(r.after)) + '%';
      line.style.width = Math.abs(x(r.after) - x(r.before)) + '%';
      track.append(line);
    }
    if (r.before !== null) {
      const dot = h('i', { class: 'dot' });
      dot.style.left = x(r.before) + '%';
      track.append(dot);
    }
    if (r.after !== null) {
      const dot = h('i', { class: 'dot after' });
      dot.style.left = x(r.after) + '%';
      track.append(dot);
    }
    return h('div', { class: 'row' },
      h('span', { class: 'name' }, r.label + ' (' + r.origin + ')'),
      track,
      h('span', { class: 'delta' }, signed(r.change, 1)));
  }

  function shiftTable(rows, caption, digits, liveKeys) {
    const cell = (key, value) => h('td', { class: 'num', 'data-live': liveKeys ? key : null }, value);
    const show = (v) => (v === null ? 'Skipped' : digits ? v.toFixed(digits) : String(v));
    return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption }, h('table', null,
      h('caption', null, caption),
      h('thead', null, h('tr', null, ['Clip', 'Origin', 'Before', 'After', 'Change'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('th', { scope: 'row' }, r.label),
        h('td', null, r.origin),
        cell(r.key + 'before', show(r.before)),
        cell(r.key + 'after', show(r.after)),
        cell(r.key + 'change', r.change === null ? 'n/a' : signed(r.change, digits || 0)))))));
  }

  function shiftSummary(rows, who) {
    const avg = (origin) => mean(rows.filter((r) => r.origin === origin && r.change !== null).map((r) => r.change));
    const human = avg('Human');
    const suno = avg('Suno');
    if (human === null || suno === null) return 'No before-and-after ratings yet.';
    const phrase = (v) => (Math.abs(v) < 0.05 ? 'stayed the same' : (v > 0 ? 'rose by ' : 'fell by ') + Math.abs(v).toFixed(1));
    const clips = single ? 'clip' : 'clips';
    return who + ' average for the human-made ' + clips + ' ' + phrase(human) + ' after the reveal, and the average for the Suno ' + clips + ' ' + phrase(suno) + '.';
  }

  function soloResults() {
    const rows = changeRows(
      (i, side) => (answers.r1[i].skipped ? null : answers.r1[i][side]),
      (i, side) => (answers.r1[i].skipped ? null : answers.r2[i][side]));
    const played = answers.r1.filter((a) => !a.skipped);
    const right = pairs.filter((pair, i) => !answers.r1[i].skipped && answers.r1[i].guess === pair.human).length;
    return stepSection('Results: you found ' + right + ' of ' + played.length + ' humans',
      h('p', { class: 'lead' }, shiftSummary(rows, 'Your')),
      h('p', null, D.caveat),
      shiftChart(rows, 'Your ratings before and after the reveal, on the 1 to 5 scale.'),
      shiftTable(rows, 'Your ratings by clip', 0),
      h('p', { class: 'question' }, D.question),
      h('h3', null, 'Questions to take with you'),
      h('ul', { class: 'notes' }, D.reflection.map((line) => h('li', null, line))),
      aboutProject());
  }

  function hostResults() {
    const stats = classStats();
    return stepSection('What happened in this room',
      h('p', { class: 'big' }, h('span', { 'data-live': 'rightAll' }, stats.rightAll), ' found the human'),
      h('p', { class: 'lead', 'data-live': 'summary' }, shiftSummary(stats.rows, ROOM)),
      h('p', null, D.caveat_room),
      h('div', { 'data-chart': 'class' }, shiftChart(stats.rows, 'Class average ratings before and after the reveal, on the 1 to 5 scale.')),
      shiftTable(stats.rows, 'Class totals: average rating by clip', 1, true),
      h('p', { class: 'big' }, 'Votes: ', h('span', { 'data-live': 'n1' }, stats.n1), ' in round 1, ', h('span', { 'data-live': 'n2' }, stats.n2), ' in round 2.'),
      h('p', { class: 'hint', 'data-live': 'updated' }, stats.updated),
      connectionLine(),
      h('div', { class: 'actions' }, h('button', {
        type: 'button', 'aria-pressed': String(live.paused),
        onclick: (e) => {
          live.paused = !live.paused;
          e.currentTarget.setAttribute('aria-pressed', String(live.paused));
          if (!live.paused) refreshLive();
        },
      }, 'Pause live updates')),
      hostNav());
  }

  function aboutProject() {
    return h('details', null,
      h('summary', null, 'About this project'),
      h('ul', null, D.about.map((line) => h('li', null, line))),
      h('h3', { style: 'margin-top:0.75rem' }, 'Made with AI'),
      h('ul', null, D.with_ai.map((line) => h('li', null, line))),
      h('h3', { style: 'margin-top:0.75rem' }, 'Made without AI'),
      h('ul', null, D.without_ai.map((line) => h('li', null, line))),
      h('h3', { style: 'margin-top:0.75rem' }, 'Sources'),
      h('ul', null, D.sources.map((s) => h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label + ' (opens in a new tab)')))));
  }

  /* ---------- class votes: phones publish one batch per round; the host page subscribes ---------- */
  let voter = null;

  function sendStatus(round) {
    const status = h('p', { role: 'status', 'data-send': round });
    const sent = round === 1 ? answers.r1Sent : answers.r2Sent;
    status.textContent = sent ? 'Vote recorded.' : 'Sending your answers...';
    return status;
  }

  async function sendRound(round) {
    const body = round === 1
      ? answers.r1.map((a) => ({ g: a.guess, a: a.a, b: a.b }))
      : answers.r2.map((a) => ({ a: a.a, b: a.b }));
    const payload = JSON.stringify({ k: 'mtt', v: voter, r: round, p: body });
    for (let attempt = 0; attempt < 7; attempt++) {
      try {
        const res = await fetch(RELAY, { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' } });
        if (res.ok) {
          if (round === 1) answers.r1Sent = true; else answers.r2Sent = true;
          store.set('mtt-vote', { answers, stepIndex, voter });
          showSend(round, 'Vote recorded.');
          return;
        }
      } catch (e) { /* retried below */ }
      showSend(round, 'Still sending, the room is busy...');
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt + Math.random() * 3000));
    }
    const failed = 'Could not send your answers. Check your connection, then tell the presenter by show of hands.';
    if (document.querySelector('[data-send="' + round + '"]')) showSend(round, failed);
    else document.getElementById('banner').append(h('p', { class: 'warn', role: 'alert' }, 'Round ' + round + ': ' + failed));
  }
  function showSend(round, text) {
    const el = document.querySelector('[data-send="' + round + '"]');
    if (el && el.textContent !== text) el.textContent = text;
  }

  const live = { paused: false, votes: { 1: new Map(), 2: new Map() }, connected: null, lastStatus: 0, lastCounts: '0|0', trailing: null, lastUpdate: null, source: null, since: null };

  function validRating(v) { return Number.isInteger(v) && v >= 1 && v <= 5; }
  function ingest(text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || m.k !== 'mtt' || typeof m.v !== 'string' || m.v.length > 40 || !Array.isArray(m.p) || m.p.length !== pairs.length) return;
    if (m.r !== 1 && m.r !== 2) return;
    const entries = m.p.map((p) => ({
      g: p && (p.g === 'a' || p.g === 'b') ? p.g : null,
      a: p && validRating(p.a) ? p.a : null,
      b: p && validRating(p.b) ? p.b : null,
    }));
    if (live.votes[m.r].size >= 500 && !live.votes[m.r].has(m.v)) return;
    live.votes[m.r].set(m.v, entries);
    live.lastUpdate = new Date();
    if (!live.paused) refreshLive();
    // A final vote inside the 30-second announcement window still gets announced.
    clearTimeout(live.trailing);
    live.trailing = setTimeout(() => { if (!live.paused) refreshLive(); }, 31000);
  }

  function classStats() {
    const r1 = [...live.votes[1].values()];
    const r2 = [...live.votes[2].values()];
    const avg = (list, i, side) => mean(list.map((v) => v[i][side]).filter((n) => n !== null));
    const rows = changeRows((i, side) => avg(r1, i, side), (i, side) => avg(r2, i, side));
    const right = pairs.map((pair, i) => {
      const guesses = r1.map((v) => v[i].g).filter(Boolean);
      return { hit: guesses.filter((g) => g === pair.human).length, total: guesses.length };
    });
    const hit = right.reduce((s, r) => s + r.hit, 0);
    const total = right.reduce((s, r) => s + r.total, 0);
    return {
      rows, right, n1: r1.length, n2: r2.length,
      rightAll: hit + ' of ' + total,
      updated: live.lastUpdate ? 'Last updated ' + live.lastUpdate.toTimeString().slice(0, 5) + '.' : 'No votes yet.',
    };
  }

  function setLive(key, value) {
    document.querySelectorAll('[data-live="' + key + '"]').forEach((el) => {
      if (el.textContent !== String(value)) el.textContent = value;
    });
  }

  function refreshLive() {
    const s = classStats();
    setLive('n1', s.n1);
    setLive('n2', s.n2);
    setLive('rightAll', s.rightAll);
    setLive('updated', s.updated);
    setLive('summary', shiftSummary(s.rows, ROOM));
    s.right.forEach((r, i) => setLive('right' + i, r.hit + ' of ' + r.total));
    s.rows.forEach((r) => {
      setLive(r.key + 'before', fmt1(r.before));
      setLive(r.key + 'after', fmt1(r.after));
      setLive(r.key + 'change', signed(r.change, 1));
    });
    const chart = document.querySelector('[data-chart="class"]');
    if (chart) chart.replaceChildren(shiftChart(s.rows, 'Class average ratings before and after the reveal, on the 1 to 5 scale.'));
    const now = Date.now();
    const counts = s.n1 + '|' + s.n2;
    if (!live.paused && counts !== live.lastCounts && now - live.lastStatus > 30000) {
      live.lastCounts = counts;
      live.lastStatus = now;
      liveStatus.textContent = 'Class totals updated: ' + s.n1 + ' votes in round 1, ' + s.n2 + ' in round 2.';
    }
  }

  function connectionLine() {
    return h('p', { class: 'hint', 'data-live': 'conn' }, connectionText());
  }
  function connectionText() {
    if (live.connected === false) return 'Live totals unavailable. Showing last known totals. Use a show of hands if this stays.';
    return live.connected ? 'Live totals connected.' : 'Connecting to live totals...';
  }
  function setConnected(value) {
    if (live.connected === value) return;
    const was = live.connected;
    live.connected = value;
    setLive('conn', connectionText());
    if (value === false || was === false) liveStatus.textContent = connectionText();
  }

  function connectRelay() {
    if (live.source) live.source.close();
    live.source = new EventSource(RELAY + '/sse?since=' + live.since);
    live.source.onopen = () => setConnected(true);
    live.source.onerror = () => setConnected(false);
    live.source.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.event === 'message') ingest(m.message);
      } catch (err) { /* ignore anything that is not a relay message */ }
    };
    live.source.addEventListener('open', () => setConnected(true));
  }

  function resetVotes() {
    live.since = Math.floor(Date.now() / 1000);
    store.set('mtt-host-since', live.since);
    live.votes = { 1: new Map(), 2: new Map() };
    live.lastUpdate = null;
    live.lastCounts = '0|0';
    connectRelay();
    refreshLive();
    liveStatus.textContent = 'Practice votes cleared.';
  }

  /* ---------- start ---------- */
  if (D.placeholder) {
    document.getElementById('banner').append(h('p', { class: 'warn' }, 'TEST AUDIO: the Suno clips are placeholder tones. Do not submit or present this build.'));
  }

  if (MODE === 'host') {
    live.since = store.get('mtt-host-since') || Math.floor(Date.now() / 1000);
    store.set('mtt-host-since', live.since);
    connectRelay();
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA|AUDIO|BUTTON)$/.test(e.target.tagName) && !/^Page/.test(e.key)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); back(); }
    });
  }

  let startIndex = 0;
  if (MODE === 'vote') {
    const saved = store.get('mtt-vote');
    if (saved && saved.answers && saved.answers.r1 && saved.answers.r1.length === pairs.length) {
      answers = saved.answers;
      startIndex = saved.stepIndex || 0;
      voter = saved.voter;
    }
    if (!voter) {
      voter = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }

  // First paint: no focus move on load.
  go(startIndex, true);

  // A phone reloaded before its send finished sends again; the host keeps one vote per voter.
  if (MODE === 'vote') {
    if (startIndex >= flow.indexOf('vote-wait') && !answers.r1Sent) sendRound(1);
    if (startIndex === flow.indexOf('vote-done') && !answers.r2Sent) sendRound(2);
  }
})();
