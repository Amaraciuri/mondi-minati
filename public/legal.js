// Privacy Policy and Terms of Use: show one language. It follows ?lang=, then the language
// chosen in the game, then the device; the EN/IT switch changes it.
(function () {
  function pick() {
    var m = /[?&]lang=(it|en)\b/.exec(location.search);
    if (m) return m[1];
    try {
      var st = JSON.parse(localStorage.getItem('mondi-minati-v1') || '{}').settings || {};
      if (st.langChosen && (st.lang === 'it' || st.lang === 'en')) return st.lang;
    } catch (e) {
      /* storage unavailable */
    }
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return /^it\b/i.test(nav) ? 'it' : 'en';
  }

  var root = document.documentElement;
  var titleEn = document.title;
  var titleIt = titleEn
    .replace('Privacy Policy', 'Informativa sulla privacy')
    .replace('Terms of Use', "Termini d'uso")
    .replace('Mined Worlds', 'Mondi Minati');

  function show(l) {
    root.setAttribute('data-show', l);
    root.lang = l;
    document.title = l === 'it' ? titleIt : titleEn;
    var b = document.querySelectorAll('.lang button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].getAttribute('data-set') === l));
  }

  root.setAttribute('data-show', pick());
  document.addEventListener('DOMContentLoaded', function () {
    show(root.getAttribute('data-show'));
    var b = document.querySelectorAll('.lang button');
    for (var i = 0; i < b.length; i++) {
      b[i].addEventListener('click', function () {
        show(this.getAttribute('data-set'));
      });
    }
  });
})();
