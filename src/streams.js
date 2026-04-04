// Vorra — YouTube Stream Database (Curated)
// ~95 streams across 56 subcategories (1-2 top picks each)
// type: "live" = 24/7 live stream, "video" = long video/mix

export const YT_PARENT_CATS = [
  { key:"lofi",label:"Lo-fi" },
  { key:"jazz",label:"Jazz" },
  { key:"classical",label:"Classical" },
  { key:"ambient",label:"Ambient" },
  { key:"synth",label:"Electronic" },
  { key:"focus",label:"Focus" },
  { key:"chill",label:"Chill" },
  { key:"asmr",label:"ASMR" },
  { key:"sleep",label:"Sleep" },
  { key:"world",label:"World" },
];

export const YT_CATS = [
  { key:"lofi-beats",label:"Lo-fi Beats",parent:"lofi" },
  { key:"lofi-study",label:"Lo-fi Study",parent:"lofi" },
  { key:"lofi-japan",label:"Japanese Lofi",parent:"lofi" },
  { key:"lofi-korean",label:"Korean Lofi",parent:"lofi" },
  { key:"lofi-night",label:"Night Lofi",parent:"lofi" },
  { key:"lofi-retro",label:"Retro/Nostalgic",parent:"lofi" },
  { key:"lofi-sad",label:"Sad Lofi",parent:"lofi" },
  { key:"jazz-cafe",label:"Jazz Cafe",parent:"jazz" },
  { key:"jazz-bossa",label:"Bossa Nova",parent:"jazz" },
  { key:"jazz-morning",label:"Morning Jazz",parent:"jazz" },
  { key:"jazz-night",label:"Night Jazz",parent:"jazz" },
  { key:"jazz-piano",label:"Jazz Piano",parent:"jazz" },
  { key:"jazz-soul",label:"Jazz & Soul",parent:"jazz" },
  { key:"jazz-romantic",label:"Romantic Jazz",parent:"jazz" },
  { key:"jazz-holiday",label:"Holiday Jazz",parent:"jazz" },
  { key:"classical-piano",label:"Piano",parent:"classical" },
  { key:"classical-guitar",label:"Guitar",parent:"classical" },
  { key:"classical-orch",label:"Orchestra",parent:"classical" },
  { key:"classical-epic",label:"Epic/Cinematic",parent:"classical" },
  { key:"ambient-rain",label:"Rain",parent:"ambient" },
  { key:"ambient-storm",label:"Storms",parent:"ambient" },
  { key:"ambient-raincafe",label:"Rain Cafe",parent:"ambient" },
  { key:"ambient-ocean",label:"Ocean",parent:"ambient" },
  { key:"ambient-river",label:"River",parent:"ambient" },
  { key:"ambient-nature",label:"Nature",parent:"ambient" },
  { key:"ambient-fire",label:"Fire/Cozy",parent:"ambient" },
  { key:"ambient-cafe",label:"Cafe Ambience",parent:"ambient" },
  { key:"ambient-space",label:"Space",parent:"ambient" },
  { key:"ambient-dark",label:"Dark Ambient",parent:"ambient" },
  { key:"ambient-ethereal",label:"Ethereal",parent:"ambient" },
  { key:"ambient-fantasy",label:"Fantasy",parent:"ambient" },
  { key:"synth-retro",label:"Retrowave",parent:"synth" },
  { key:"synth-chill",label:"Chillsynth",parent:"synth" },
  { key:"synth-cyber",label:"Cyberpunk",parent:"synth" },
  { key:"synth-lounge",label:"Deep House",parent:"synth" },
  { key:"focus-deep",label:"Deep Focus",parent:"focus" },
  { key:"focus-alpha",label:"Alpha/Binaural",parent:"focus" },
  { key:"focus-brain",label:"Brain Waves",parent:"focus" },
  { key:"focus-inspire",label:"Inspirational",parent:"focus" },
  { key:"chill-gaming",label:"Gaming Beats",parent:"chill" },
  { key:"chill-ghibli",label:"Studio Ghibli",parent:"chill" },
  { key:"chill-rpg",label:"RPG Ambience",parent:"chill" },
  { key:"sleep-deep",label:"Deep Sleep",parent:"sleep" },
  { key:"sleep-delta",label:"Delta Waves",parent:"sleep" },
  { key:"sleep-lucid",label:"Lucid Dreaming",parent:"sleep" },
  { key:"asmr-sleep",label:"Sleep ASMR",parent:"asmr" },
  { key:"asmr-cafe",label:"Cafe ASMR",parent:"asmr" },
  { key:"asmr-nature",label:"Nature ASMR",parent:"asmr" },
  { key:"asmr-tingle",label:"Tingles",parent:"asmr" },
  { key:"heal-freq",label:"Healing Hz",parent:"sleep" },
  { key:"heal-relax",label:"Relaxation",parent:"sleep" },
  { key:"heal-spa",label:"Spa",parent:"sleep" },
  { key:"heal-reiki",label:"Reiki",parent:"sleep" },
  { key:"noise-brown",label:"Brown Noise",parent:"sleep" },
  { key:"noise-pink",label:"Pink Noise",parent:"sleep" },
  { key:"world-zen",label:"Zen/Asian",parent:"world" },
  { key:"world-celtic",label:"Celtic",parent:"world" },
  { key:"world-sacred",label:"Sacred Chants",parent:"world" },
  { key:"world-newage",label:"New Age",parent:"world" },
];

const s=(cat,name,desc,vid,pop,type)=>({cat,name,desc,vid,pop,type});

export const YT_STREAMS = [
  // === LO-FI ===
  // --- Lo-fi Beats ---
  s("lofi-beats","Lofi Girl","The OG beats to relax/study to","jfKfPfyJRdk",5,"live"),
  s("lofi-beats","Chillhop Music","Lo-fi hip hop & chill beats","5yx6BWlEVcY",5,"live"),
  // --- Lo-fi Study ---
  s("lofi-study","LIVE Lo-Fi Hip Hop Radio - Chi","LIVE Lo-Fi Hip Hop Radio - Chill Beats t","VErOKn2cOBY",5,"live"),
  s("lofi-study","lofi hip hop radio - beats to ","lofi hip hop radio - beats to sleep/stud","rPjez8z61rI",5,"live"),
  // --- Japanese Lofi ---
  s("lofi-japan","Japanese Lofi HipHop Mix - Sak","Japanese Lofi HipHop Mix - Sakura Harmon","ULi7xGp1o5I",3,"video"),
  s("lofi-japan","Sakura - Japanese Lofi Beat | ","Sakura - Japanese Lofi Beat | Chill & Tr","Vru03_HAV-M",3,"video"),
  // --- Korean Lofi ---
  s("lofi-korean","Korean Chill Rap / Neo-Soul / ","Korean Chill Rap / Neo-Soul / Lo-fi [K-H","NZ1CFc3tZoM",3,"video"),
  // --- Night Lofi ---
  s("lofi-night","Aesthetic Night Drive | Lofi V","Aesthetic Night Drive | Lofi Vibe & Chil","x4746g11SEE",3,"video"),
  s("lofi-night","Night Drive ~ lofi hip hop mix","Night Drive ~ lofi hip hop mix ~ beats t","zW5wpJY1rgQ",3,"video"),
  // --- Retro/Nostalgic ---
  s("lofi-retro","1980s & 90s Lofi Hip Hop Mix |","1980s & 90s Lofi Hip Hop Mix | Nostalgic","lzvZ3CELCL4",3,"video"),
  // --- Sad Lofi ---
  s("lofi-sad","Lonely Days [sad lofi]","Lonely Days [sad lofi]","O7RG-B6N1Vw",3,"video"),
  s("lofi-sad","sad lofi radio - beats for rai","sad lofi radio - beats for rainy days","P6Segk8cr-c",5,"live"),

  // === JAZZ ===
  // --- Jazz Cafe ---
  s("jazz-cafe","Coffee Shop Jazz","Cafe jazz & bossa nova","Dx5qFachd3A",5,"live"),
  s("jazz-cafe","Relax Jazz Caf\u00e9","Cozy jazz for studying","fEvM-OUbaKs",4,"live"),
  // --- Bossa Nova ---
  s("jazz-bossa","Living Coffee: Smooth Jazz Rad","Living Coffee: Smooth Jazz Radio - Relax","SORD03t7nlo",5,"live"),
  s("jazz-bossa","Cozy Cafe Music - Chill Jazz &","Cozy Cafe Music - Chill Jazz & Bossa for","gCA--UKeKl0",3,"video"),
  // --- Morning Jazz ---
  s("jazz-morning","Morning Coffee Jazz & Bossa No","Morning Coffee Jazz & Bossa Nova - Relax","dS-7U56ubnw",3,"video"),
  s("jazz-morning","Relaxing Breakfast Coffee Jazz","Relaxing Breakfast Coffee Jazz - Soothin","6nClIF3T_Zc",3,"video"),
  // --- Night Jazz ---
  s("jazz-night","Best Cozy Evening Jazz Mix Liv","Best Cozy Evening Jazz Mix Live - Relaxi","8E-Wxg39JN4",5,"live"),
  s("jazz-night","Cozy Rainy Night Jazz - Smooth","Cozy Rainy Night Jazz - Smooth Jazz with","BriPV-BHn5o",3,"video"),
  // --- Jazz Piano ---
  s("jazz-piano","Jazz Piano Bar","Cafe Music BGM channel","neV3EPgvZ3g",4,"video"),
  s("jazz-piano","Melancholy Jazz Piano","Emotional jazz piano","1ZYbU82GVz4",3,"video"),
  // --- Jazz & Soul ---
  s("jazz-soul","Jazz & Soul R&B - Smooth Instr","Jazz & Soul R&B - Smooth Instrumental Gr","5-EbIpbngRI",3,"video"),
  // --- Romantic Jazz ---
  s("jazz-romantic","Romantic Dinner Jazz | Smooth ","Romantic Dinner Jazz | Smooth Piano & Sa","mJEhUn9sOtc",3,"video"),
  // --- Holiday Jazz ---
  s("jazz-holiday","Relaxing Christmas Jazz Music ","Relaxing Christmas Jazz Music 10 Hours","lJlEQim-yMo",4,"video"),

  // === CLASSICAL ===
  // --- Piano ---
  s("classical-piano","Relaxing Piano Music Radio","Relaxing Piano Music Radio","4khIPP--FDU",5,"live"),
  s("classical-piano","4 Hours Classical Music for Re","4 Hours Classical Music for Relaxation","0Tmo3KIH31c",4,"video"),
  // --- Guitar ---
  s("classical-guitar","3 Hour Relaxing Guitar Music: ","3 Hour Relaxing Guitar Music: Meditation","ss7EJ-PW2Uk",4,"video"),
  s("classical-guitar","Acoustic Chill - A Soft Indie ","Acoustic Chill - A Soft Indie Folk Playl","Krdt6FGuB3I",4,"video"),
  // --- Orchestra ---
  s("classical-orch","Heavenly Orchestra - Beautiful","Heavenly Orchestra - Beautiful Relaxing ","5fflfpMilyk",3,"video"),
  // --- Epic/Cinematic ---
  s("classical-epic","Epic Cinematic Soundtracks - 2","Epic Cinematic Soundtracks - 2 Hours Ins","PBSWXifeoCQ",4,"video"),
  s("classical-epic","Hans Zimmer EPIC MUSIC - Best ","Hans Zimmer EPIC MUSIC - Best of 1 Hour","hHwqfT4mhfI",3,"video"),

  // === AMBIENT ===
  // --- Rain ---
  s("ambient-rain","Rain on Window","Gentle rain on glass - pure rain sounds, no music","mPZkdNFkNps",4,"video"),
  s("ambient-rain","Rain Sounds for Sleep","Heavy rain sounds 24/7 for sleeping and relaxation","q76bMs-NwRk",4,"live"),
  // --- Storms ---
  s("ambient-storm","Heavy Rain and Thunder Sounds ","Heavy Rain and Thunder Sounds for Sleepi","0V0SKiiFZMs",5,"live"),
  s("ambient-storm","Thunderstorm Rain Sounds for S","Thunderstorm Rain Sounds for Sleeping - ","M7IW6xtVxuw",5,"live"),
  // --- Rain Cafe ---
  s("ambient-raincafe","Cozy Rainy Evening","Relaxing Jazz Music with rain and cozy cafe atmosphere","AGtye69u67c",3,"video"),
  s("ambient-raincafe","Rainy Night Coffee Shop","Rain and coffee shop ambience for studying","cJHNojyov9w",3,"video"),
  // --- Ocean ---
  s("ambient-ocean","Ocean Waves White Noise for Sl","Ocean Waves White Noise for Sleeping 10 ","JekUNGo-RVk",4,"video"),
  s("ambient-ocean","Ocean Waves for Sleep | relaxi","Ocean Waves for Sleep | relaxing beach s","K-NtrkLy7U4",3,"video"),
  // --- River ---
  s("ambient-river","Forest Stream Flowing Sound 24","Forest Stream Flowing Sound 24/7. Relaxing river and nature sounds","jKtofppPJFk",5,"live"),
  s("ambient-river","Gentle River Sounds","Peaceful creek sounds for relaxation and focus","IvjMgVS2kgQ",4,"video"),
  // --- Nature ---
  s("ambient-nature","Spring Forest Ambience","Nature Sounds - Birds Singing, Forest Atmosphere","bN6PNAN3ZCc",4,"video"),
  s("ambient-nature","Morning Bird Songs","Relaxing bird sounds in nature for focus and calm","rYoZgpAEkFs",4,"video"),
  // --- Fire/Cozy ---
  s("ambient-fire","Crackling Campfire & Crickets","Live crackling campfire with soothing night cricket sounds","vR7rWIs4wbc",5,"live"),
  s("ambient-fire","Fireplace & Rain","Cozy fireplace with rainfall sounds","3sL0omwElxw",4,"video"),
  s("ambient-fire","Cozy Fireplace 4K (12 HOURS)","12 hours of crackling fireplace sounds","J-0cGMDo1mU",4,"video"),
  // --- Cafe Ambience ---
  s("ambient-cafe","Coffee Shop Ambience","Cafe background noise - chatter, cups, espresso machines","uiMXGIG_DQo",3,"video"),
  s("ambient-cafe","Paris Cafe Ambience","French cafe sounds with light rain outside","8dSTEL19mGs",3,"video"),
  // --- Space ---
  s("ambient-space","Space Ambient","Cosmic ambient soundscapes - deep space drones","S_MOd40zlYU",4,"video"),
  s("ambient-space","NASA Deep Space Sounds","Actual space sounds recorded by NASA spacecraft","IQL53eQ0cNA",3,"video"),
  // --- Dark Ambient ---
  s("ambient-dark","Ad-Free Dark Ambient Mix - 12 ","Ad-Free Dark Ambient Mix - 12 Hours of D","8yc2mzZfmJI",4,"video"),
  // --- Ethereal ---
  s("ambient-ethereal","Elysium - Ethereal Fantasy Amb","Elysium - Ethereal Fantasy Ambient Journ","9p5Tokd-93k",3,"video"),
  s("ambient-ethereal","Flow - Ethereal Healing Medita","Flow - Ethereal Healing Meditation Music","plWAM6wUeI0",3,"video"),
  // --- Fantasy ---
  s("ambient-fantasy","Immersive Middle Earth Atmosph","Immersive Middle Earth Atmosphere - Fant","Jj-tbczVi44",3,"video"),
  s("ambient-fantasy","A Magical Fantasy Ambient Jour","A Magical Fantasy Ambient Journey [DEEPL","zWK6ZeYllq8",3,"video"),

  // === ELECTRONIC ===
  // --- Retrowave ---
  s("synth-retro","Synthwave Radio","80s synth vibes 24/7","4xDzrJKXOOY",4,"live"),
  s("synth-retro","Retrowave TV","Neon-drenched retro","5-anTj1QrWs",3,"live"),
  // --- Chillsynth ---
  s("synth-chill","ChillSynth FM","Relaxed synth music","UedTcufyrHc",4,"live"),
  s("synth-chill","Nostalgic 80s lofi - Retro Bea","Nostalgic 80s lofi - Retro Beats & Synth","sYmWml0DEiI",3,"video"),
  // --- Cyberpunk ---
  s("synth-cyber","Cyberpunk Night City 9hrs","ASMR ambience","SthlzIeMNW8",5,"video"),
  s("synth-cyber","Cyberpunk 2077 Rain","Arasaka docks ambience","xMvm9U8wEdA",4,"video"),
  // --- Deep House ---
  s("synth-lounge","3 HOURS Deep House - Chillout ","3 HOURS Deep House - Chillout - Lounge M","IPjZM9o6ukc",4,"video"),
  s("synth-lounge","DEEP HOUSE - CHILLOUT - LOUNGE","DEEP HOUSE - CHILLOUT - LOUNGE BEATS | 3","59LMreYagUU",4,"video"),

  // === FOCUS ===
  // --- Deep Focus ---
  s("focus-deep","Deep Focus Music","Intense concentration","oPVte6aMprI",4,"video"),
  s("focus-deep","Coding Music","Programming focus beats","f02mOEt11OQ",3,"video"),
  // --- Alpha/Binaural ---
  s("focus-alpha","3 Hour Focus Music: Study Musi","3 Hour Focus Music: Study Music, Alpha W","5LXhPbmoHmU",4,"video"),
  s("focus-alpha","10Hz Binaural Beats | Alpha Wa","10Hz Binaural Beats | Alpha Waves for Fo","z5hBiW3BV4M",4,"video"),
  // --- Brain Waves ---
  s("focus-brain","Brain Power Music","Alpha wave focus","WPni755-Krg",4,"video"),
  // --- Inspirational ---
  s("focus-inspire","Inspirational Music Instrument","Inspirational Music Instrumental | Calmi","T96iWDuubEI",3,"video"),

  // === CHILL ===
  // --- Gaming Beats ---
  s("chill-gaming","Zelda & Chill","Full album GameChops","icwbu-9douY",5,"video"),
  s("chill-gaming","Pokemon & Chill","Full album 4K","wQ2OhGwZaK4",5,"video"),
  // --- Studio Ghibli ---
  s("chill-ghibli","Ghibli Coffee Shop","Lofi songs to study","zhDwjnYZiCo",5,"video"),
  s("chill-ghibli","Studio Ghibli Lofi","Ghibli but lofi beats","N3ur5Ey21zg",5,"video"),
  // --- RPG Ambience ---
  s("chill-rpg","Persona 5 Beneath Mask","Rainy mood 10hrs","Uq7kyf1T_lk",5,"video"),
  s("chill-rpg","Skyrim Atmospheres","Jeremy Soule OST","YPZtRmx1Dyk",5,"video"),

  // === SLEEP ===
  // --- Deep Sleep ---
  s("sleep-deep","8 Hour Deep Sleep Music","Deep Sleep Music: Sleep Meditation Music, Relaxing Music","v-Ryb13PUIs",4,"video"),
  s("sleep-deep","10 Hour Sleep Music","Calming deep sleep music for insomnia relief","rvaqPPjGLz4",4,"video"),
  // --- Delta Waves ---
  s("sleep-delta","10 Hours Deep SLEEP Music, [2.","10 Hours Deep SLEEP Music, [2.8 Hz] DELT","TaDKA-b8sk8",4,"video"),
  s("sleep-delta","8 Hour Deep Sleep Music: Delta","8 Hour Deep Sleep Music: Delta Waves, Re","txQ6t4yPIM0",4,"video"),
  // --- Lucid Dreaming ---
  s("sleep-lucid","10 Hours of Deep Relaxing Musi","10 Hours of Deep Relaxing Music for Slee","22q2O_fibaU",4,"video"),
  s("sleep-lucid","8 Hour Lucid Dreaming Sleep Mu","8 Hour Lucid Dreaming Sleep Music NOW WI","EPaQWg1yUMw",4,"video"),
  // === ASMR ===
  // --- Sleep ASMR ---
  s("asmr-sleep","ASMR Tingles for Sleep","ASMR Tingles for When You Need to SLEEP","xKl3aI3IU9Q",3,"video"),
  s("asmr-sleep","Extremely Tingly ASMR","Extremely Tingly ASMR for Sleep and Relaxation","pHg3ytkLWuI",3,"video"),
  // --- Cafe ASMR ---
  s("asmr-cafe","ASMR Coffee Shop Sound","ASMR Coffee Shop Sound | NO MUSIC | Coffee Shop Ambience","qU8o3_T5y5M",3,"video"),
  s("asmr-cafe","Cozy Rain Cafe ASMR","Cozy Evening Rain Cafe Vibes - Cafe ASMR sounds","MM_hG2z6gRs",3,"video"),
  // --- Nature ASMR ---
  s("asmr-nature","ASMR Forest Walk","Relaxing forest walk ASMR - crunching leaves, birds","wSzpSqYOTRc",3,"video"),
  // --- Tingles ---
  s("asmr-tingle","Best ASMR Triggers","The Best ASMR Triggers for Instant Relaxation","Sda1rFn2fAk",3,"video"),
  // --- Healing Hz ---
  s("heal-freq","432 Hz Deep Healing Frequency ","432 Hz Deep Healing Frequency | Golden H","nLr7dHZqxng",4,"video"),
  s("heal-freq","Gregorian Chants at 432Hz | 3 ","Gregorian Chants at 432Hz | 3 Hours of H","W-hrBhA4XkM",4,"video"),
  // --- Relaxation ---
  s("heal-relax","8 HOURS Calming Music for High","8 HOURS Calming Music for Highly Sensiti","zaCWSv4P254",4,"video"),
  s("heal-relax","Beautiful Relaxing Music for S","Beautiful Relaxing Music for Stress Reli","lFcSrYw-ARY",3,"video"),
  // --- Spa ---
  s("heal-spa","10 Hours Relaxing Spa Music - ","10 Hours Relaxing Spa Music - Spa Massag","HW5AHoclaYc",4,"video"),
  s("heal-spa","6 Hour Relaxing Spa Music: Mas","6 Hour Relaxing Spa Music: Massage Music","EZVHjVbUP40",4,"video"),
  // --- Reiki ---
  s("heal-reiki","3 Hour Reiki Healing Music: Me","3 Hour Reiki Healing Music: Meditation M","j_XvqwnGDko",4,"video"),
  // --- Brown Noise ---
  s("noise-brown","LIVE 24/7 Deep Brown Noise for","LIVE 24/7 Deep Brown Noise for Sleep and","boRR7Mdbit8",5,"live"),
  s("noise-brown","Smoothed Brown Noise - 12 Hour","Smoothed Brown Noise - 12 Hours, for Sle","-teK_6JX9gc",4,"video"),
  // --- Pink Noise ---
  s("noise-pink","12 HOURS of PINK NOISE - Get B","12 HOURS of PINK NOISE - Get Baby to Sle","2UfzOXyp8MY",4,"video"),

  // === WORLD ===
  // --- Zen/Asian ---
  s("world-zen","3 Hour Zen Meditation Music: N","3 Hour Zen Meditation Music: Nature Soun","WZKW2Hq2fks",4,"video"),
  s("world-zen","6 Hour Zen Meditation Music: C","6 Hour Zen Meditation Music: Calming Mus","aaEvhnb2vDE",4,"video"),
  // --- Celtic ---
  s("world-celtic","Instrumental Celtic Music Live","Instrumental Celtic Music Live 24/7 | De","knuQ2T5HWMQ",5,"live"),
  s("world-celtic","Relaxing Irish Music - 3 Hour ","Relaxing Irish Music - 3 Hour Celtic Ins","pw4_C4zmGKo",4,"video"),
  // --- Sacred Chants ---
  s("world-sacred","1 hour of Peaceful Gregorian C","1 hour of Peaceful Gregorian Chants: Dan","WreFJzRPYng",4,"video"),
  s("world-sacred","OM Chanting @528 Hz | 8 Hours","OM Chanting @528 Hz | 8 Hours","J7mZXwbddWg",4,"video"),
  // --- New Age ---
  s("world-newage","New Age Meditation Music - Dee","New Age Meditation Music - Deep Relaxati","k_zfpw6uPeI",3,"video"),
  s("world-newage","Spiritual New Age Music - Deep","Spiritual New Age Music - Deep Inner Hea","43olDlb-qFA",3,"video"),

];