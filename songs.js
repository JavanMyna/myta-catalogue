/* =================================================== */
/* Fred's Archive — songs.js                            */
/* Single source of truth for the music section.       */
/*                                                     */
/* TASK 5/6/7: every song lives here. The renderer      */
/* (script.js) reads this list to build the track      */
/* rows, the story cards, the SoundCloud title links,  */
/* and the preview/full-track player.                  */
/*                                                     */
/* FIELDS                                              */
/*   id           stable string id used for data-song-id */
/*   title        display title                       */
/*   category     group heading (matches on-site tab)   */
/*   type         "Composition", "Soundtrack", etc.   */
/*   soundcloudUrl  full URL to the track on SoundCloud; */
/*                  null means this track has NO        */
/*                  SoundCloud source (Lyna is the     */
/*                  original special case).            */
/*   story        optional free-text story behind the    */
/*                song. Leave "" to show the "Story    */
/*                coming soon" placeholder in the card.  */
/*   previewSrc   short ~20–30s preview clip path.      */
/*                null means previewing isn't set up     */
/*                yet — the player then falls back to    */
/*                the full track with preload="none"    */
/*                (NOT the brief's ideal, but no clip    */
/*                trimming tool was available here).    */
/*                When you've cut a preview clip, drop   */
/*                it in audio/previews/ and set this     */
/*                field — the player will use it and a   */
/*                "Play full track" button appears.     */
/*   fullSrc      the original mp3 used for "Play full   */
/*                track" (and the default audio src      */
/*                whenever previewSrc is null).         */
/*                                                     */
/* FRED — TODO: the soundcloudUrl values below are      */
/* placeholders pointing at the JavanMyna profile. They  */
/* make the title-link visibly work until you paste each  */
/* track's real SoundCloud URL. Replace them with the    */
/* specific track URLs as you find them. Keep Lyna null.  */
/* =================================================== */

window.SONGS = [
    {
        id: "lifeline",
        title: "Lifeline",
        category: "Personal Favourites",
        type: "Composition",
        soundcloudUrl: "https://soundcloud.com/javanmyna/lifeline?in=javanmyna/sets/pint-of-breakcore&si=0402c4f5362947f3bc5dcebda09d4c57&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "31/08/2024 : I was watching Terror in Resonance anime one day and one of their ost (nc17) made me feel something... ",
        previewSrc: null,
        fullSrc: "assets/music/lifeline.mp3"
    },
    {
        id: "pxr-ncrpqnq-nr-pq1",
        title: "P(Xr), nCrP^nQ^n-r, PQ1",
        category: "Personal Favourites",
        type: "Composition",
        soundcloudUrl: "https://soundcloud.com/javanmyna/p-xr-ncrp-nq-n-r-pq1?si=68eac96456eb485db29738bb1e436845&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "30/09/2024 : During the time I composed this, I was very obsessed with the binomial distribution formula. So named after it.",
        previewSrc: null,
        fullSrc: "assets/music/P(Xr),%20nCrP%5EnQ%5En-r,%20PQ1.mp3"
    },
    {
        id: "fy-ibng",
        title: "Fy, IbnG",
        category: "Personal Favourites",
        type: "Composition",
        soundcloudUrl: "https://soundcloud.com/javanmyna/untitled?si=af185bdc7da449e090a1c01083a19ec1&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "14/05/2025 : I rather not say",
        previewSrc: null,
        fullSrc: "assets/music/Fy,IbnG.mp3"
    },
    {
        id: "lm",
        title: "Lian & Mei",
        category: "Personal Favourites",
        type: "Composition",
        soundcloudUrl: "https://soundcloud.com/javanmyna/lian-and-mei?in=javanmyna/sets/2025a1&si=1ccccc62a1564ce68e54ec439cbecb57&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "18/02/2025 : It was just weeks after my last spm paper ended. I wanted a way to celebrate it. For some reason, months later after watching Lookback anime, it reminded me of this.",
        previewSrc: null,
        fullSrc: "assets/music/l&m.mp3"
    },
    {
        id: "dazed",
        title: "Dazed",
        category: "Mis1nf0 OST",
        type: "Soundtrack",
        soundcloudUrl: "https://soundcloud.com/javanmyna/dazed?si=fc159ce39f944309acf59c3c3ef1adb5&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "09/01/2024 : Initially there's actually drums in the music but my friend said it sounded so happy. So when I went to remove it, now it sounds like the type of stuff you hear when you're otw home.",
        previewSrc: null,
        fullSrc: "assets/music/dazed.mp3"
    },
    {
        id: "dfordustbin",
        title: "dfordustbin",
        category: "Mis1nf0 OST",
        type: "Soundtrack",
        soundcloudUrl: "https://soundcloud.com/javanmyna/dfordumpster?si=4c3fbe18e38d4a85b54b189973d42acb&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
        story: "11/01/2024 : Literally the first week I was playing around with the Beepbox. I got into this because my friend needed someone to make music for their game and since I was like passionate about music, they brought me in even tho I had no experiences making my own music. Maybe thats why how I ended up making music that sounds like they belong in a game.",
        previewSrc: null,
        fullSrc: "assets/music/dfordustbin.mp3"
    },
    {
        id: "deadpool-bag2",
        title: "Deadpool Bag",
        category: "Birthday Gifts",
        type: "Composition",
        soundcloudUrl: null,
        story: "02/11/2025 : To the long lost friend I reunited in matrics",
        previewSrc: null,
        fullSrc: "assets/music/deadpool_bag2.mp3"
    },
    {
        id: "lyna",
        title: "Lyna",
        category: "Birthday Gifts",
        type: "Composition",
        soundcloudUrl: null,
        story: "03/03/2026 : I made this for my closest friend in matrics, my study buddy",
        previewSrc: null,
        fullSrc: "assets/music/lyna.mp3"
    },
    {
        id: "manyafication",
        title: "Manyafication",
        category: "Birthday Gifts",
        type: "Composition",
        soundcloudUrl: null,
        story: "22/06/2025 : I made this for the friend that introduced me to music composing",
        previewSrc: null,
        fullSrc: "assets/music/manyafication.mp3"
    }
];