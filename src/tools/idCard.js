const { createCanvas } = require("canvas");

// Comprehensive country ID templates
const COUNTRIES = {
  // Africa
  cameroon: { name: "Cameroon", flag: "🇨🇲", colors: { primary: "#007a3d", secondary: "#ce1126", accent: "#fcd116", bg: "#f5f5f0" }, header: "REPUBLIQUE DU CAMEROUN", motto: "UN - UNITÉ - PATRIE", type: "CARTE D'IDENTITÉ NATIONALE", fields: ["nom", "prenom", "date_naissance", "sexe", "n_carte"] },
  nigeria: { name: "Nigeria", flag: "🇳🇬", colors: { primary: "#008751", secondary: "#ffffff", accent: "#008751", bg: "#f8f8f8" }, header: "FEDERAL REPUBLIC OF NIGERIA", motto: "UNITY AND FAITH, PEACE AND PROGRESS", type: "NATIONAL IDENTITY CARD", fields: ["last_name", "first_name", "date_of_birth", "gender", "nin"] },
  ghana: { name: "Ghana", flag: "🇬🇭", colors: { primary: "#ce1126", secondary: "#000000", accent: "#fcd116", bg: "#fafafa" }, header: "THE REPUBLIC OF GHANA", motto: "FREEDOM AND JUSTICE", type: "GHANA CARD", fields: ["surname", "other_names", "date_of_birth", "sex", "ghipss_no"] },
  senegal: { name: "Senegal", flag: "🇸🇳", colors: { primary: "#00853f", secondary: "#f42a4e", accent: "#fff500", bg: "#f5f5f5" }, header: "REPUBLIQUE DU SENEGAL", motto: "UN PEUPLE - UN BUT - UNE FOI", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  ivory_coast: { name: "Ivory Coast", flag: "🇨🇮", colors: { primary: "#f77f00", secondary: "#009e60", accent: "#ffffff", bg: "#fafafa" }, header: "REPUBLIQUE DE COTE D'IVOIRE", motto: "UNITE - DISCIPLINE - TRAVAIL", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  togo: { name: "Togo", flag: "🇹🇬", colors: { primary: "#006a4e", secondary: "#ff0000", accent: "#fcd116", bg: "#f5f5f5" }, header: "REPUBLIQUE TOGOLAISE", motto: "PAIX - TRAVAIL - PATRIE", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  benin: { name: "Benin", flag: "🇧🇯", colors: { primary: "#008751", secondary: "#e8112d", accent: "#fcd116", bg: "#f5f5f5" }, header: "REPUBLIQUE DU BENIN", motto: "FRATERNITE - JUSTICE - TRAVAIL", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  burkina_faso: { name: "Burkina Faso", flag: "🇧🇫", colors: { primary: "#009e49", secondary: "#ef2b29", accent: "#fcd116", bg: "#f5f5f5" }, header: "PAYS DE L'HOMME INTEGR E", motto: "UNION - JUSTICE - TRAVAIL", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  mali: { name: "Mali", flag: "🇲🇱", colors: { primary: "#14b53a", secondary: "#ce1126", accent: "#fcd116", bg: "#fafafa" }, header: "REPUBLIQUE DU MALI", motto: "UN PEUPLE - UN BUT - UNE FOI", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  guinea: { name: "Guinea", flag: "🇬🇳", colors: { primary: "#ce1126", secondary: "#fcd116", accent: "#009e60", bg: "#fafafa" }, header: "REPUBLIQUE DE GUINEE", motto: "TRAVAIL - JUSTICE - SOLIDARITE", type: "CARTE D'IDENTITE NATIONALE", fields: ["nom", "prenoms", "date_naissance", "sexe", "n_carte"] },
  cape_verde: { name: "Cape Verde", flag: "🇨🇻", colors: { primary: "#003893", secondary: "#cf202f", accent: "#fcd116", bg: "#fafafa" }, header: "REPUBLICA DE CABO VERDE", motto: "UNITÁ, LUTA, DISCIPLINA", type: "CARTE DE IDENTIDADE", fields: ["nome", "data_nascimento", "sexo", "n_cartao"] },
  congo: { name: "Congo", flag: "🇨🇬", colors: { primary: "#009742", secondary: "#fbcd03", accent: "#d21034", bg: "#f5f5f5" }, header: "REPUBLIQUE DU CONGO", motto: "UNITÉ - TRAVAIL - DÉVELOPPEMENT", type: "CARTE D'IDENTITÉ NATIONALE", fields: ["nom", "prénoms", "date_naissance", "sexe", "n_carte"] },
  dr_congo: { name: "DR Congo", flag: "🇨🇩", colors: { primary: "#007fff", secondary: "#ce1021", accent: "#f7d618", bg: "#f5f5f5" }, header: "REPUBLIQUE DEMOCRATIQUE DU CONGO", motto: "JUSTICE - PAIX - TRAVAIL", type: "CARTE D'IDENTITÉ NATIONALE", fields: ["nom", "prénoms", "date_naissance", "sexe", "n_carte"] },
  gabon: { name: "Gabon", flag: "🇬🇦", colors: { primary: "#009e49", secondary: "#fcd116", accent: "#3a75c4", bg: "#f5f5f5" }, header: "REPUBLIQUE GABONAISE", motto: "UN PEUPLE - UN but - UNE FOI", type: "CARTE D'IDENTITÉ NATIONALE", fields: ["nom", "prénoms", "date_naissance", "sexe", "n_carte"] },
  guinea_bissau: { name: "Guinea-Bissau", flag: "🇬🇼", colors: { primary: "#009e49", secondary: "#fcd116", accent: "#ce1126", bg: "#fafafa" }, header: "REPUBLICA DA GUINE-BISSAU", motto: "UNIDADE, LUTA, PROGRESSO", type: "CARTE DE IDENTIDADE", fields: ["nome", "data_nascimento", "sexo", "n_cartao"] },
  liberia: { name: "Liberia", flag: "🇱🇷", colors: { primary: "#ce1126", secondary: "#ffffff", accent: "#002868", bg: "#fafafa" }, header: "REPUBLIC OF LIBERIA", motto: "THE LOVE OF LIBERITY BROUGHT US HERE", type: "NATIONAL IDENTITY CARD", fields: ["last_name", "first_name", "date_of_birth", "gender", "id_number"] },
  mauritania: { name: "Mauritania", flag: "🇲🇷", colors: { primary: "#006233", secondary: "#ce1126", accent: "#ffffff", bg: "#f5f5f5" }, header: "REPUBLIQUE ISLAMIQUE DE MAURITANIE", motto: "Honneur - Fraternité - Justice", type: "CARTE D'IDENTITÉ NATIONALE", fields: ["nom", "prénoms", "date_naissance", "sexe", "n_carte"] },
  mauritius: { name: "Mauritius", flag: "🇲🇺", colors: { primary: "#ea2b2b", secondary: "#1a206d", accent: "#ffd500", bg: "#fafafa" }, header: "REPUBLIC OF MAURITIUS", motto: "Strengthened by Purity", type: "NATIONAL IDENTITY CARD", fields: ["surname", "other_names", "date_of_birth", "sex", "id_number"] },
  sao_tome: { name: "Sao Tome", flag: "🇸🇹", colors: { primary: "#007a3d", secondary: "#fcd116", accent: "#ce1126", bg: "#f5f5f5" }, header: "REPÚBLICA DE SÃO TOMÉ E PRÍNCIPE", motto: "Unidade, Disciplina, Progresso", type: "CARTE DE IDENTIDADE", fields: ["nome", "data_nascimento", "sexo", "n_cartao"] },
  sierra_leone: { name: "Sierra Leone", flag: "🇸🇱", colors: { primary: "#1eb53a", secondary: "#ffffff", accent: "#0072c6", bg: "#fafafa" }, header: "REPUBLIC OF SIERRA LEONE", motto: "UNITY FREEDOM JUSTICE", type: "NATIONAL IDENTITY CARD", fields: ["last_name", "first_name", "date_of_birth", "gender", "id_number"] },
  zambia: { name: "Zambia", flag: "🇿🇲", colors: { primary: "#198a00", secondary: "#ef7d00", accent: "#000000", bg: "#fafafa" }, header: "REPUBLIC OF ZAMBIA", motto: "ONE NATION ONE FUTURE", type: "NATIONAL IDENTITY CARD", fields: ["surname", "other_names", "date_of_birth", "sex", "id_number"] },
  
  // Europe
  france: { name: "France", flag: "🇫🇷", colors: { primary: "#002395", secondary: "#ed2939", accent: "#ffffff", bg: "#fafafa" }, header: "REPUBLIQUE FRANÇAISE", motto: "LIBERTE EGALITE FRATERNITE", type: "CARTE D'IDENTITE", fields: ["nom", "prenom", "date_naissance", "sexe", "n_carte"] },
  germany: { name: "Germany", flag: "🇩🇪", colors: { primary: "#000000", secondary: "#dd0000", accent: "#ffcc00", bg: "#f5f5f5" }, header: "BUNDESREPUBLIK DEUTSCHLAND", motto: "", type: "PERSONALAUSWEIS", fields: ["nachname", "vorname", "geburtsdatum", "geschlecht", "ausweismnummer"] },
  uk: { name: "United Kingdom", flag: "🇬🇧", colors: { primary: "#012169", secondary: "#c8102e", accent: "#ffffff", bg: "#fafafa" }, header: "UNITED KINGDOM", motto: "", type: "PASSPORT / ID CARD", fields: ["surname", "first_names", "date_of_birth", "sex", "passport_no"] },
  spain: { name: "Spain", flag: "🇪🇸", colors: { primary: "#c60b1e", secondary: "#ffc400", accent: "#ffffff", bg: "#fafafa" }, header: "ESPAÑA", motto: "", type: "DOCUMENTO NACIONAL DE IDENTIDAD", fields: ["apellidos", "nombre", "fecha_nacimiento", "sexo", "nif"] },
  italy: { name: "Italy", flag: "🇮🇹", colors: { primary: "#008c45", secondary: "#cd212a", accent: "#f4f5f0", bg: "#fafafa" }, header: "REPUBBLICA ITALIANA", motto: "", type: "Tessera Sanitaria / Carta d'Identità", fields: ["cognome", "nome", "data_di_nascita", "sesso", "codice_fiscale"] },
  portugal: { name: "Portugal", flag: "🇵🇹", colors: { primary: "#006600", secondary: "#ff0000", accent: "#ffcc00", bg: "#fafafa" }, header: "REPÚBLICA PORTUGUESA", motto: "", type: "Cartão de Cidadão", fields: ["nome", "data_nascimento", "sexo", "numero_identificacao"] },
  netherlands: { name: "Netherlands", flag: "🇳🇱", colors: { primary: "#ae1c28", secondary: "#21468b", accent: "#ffffff", bg: "#fafafa" }, header: "KONINKRIJK DER NEDERLANDEN", motto: "", type: "Identiteitsbewijs", fields: ["achternaam", "voornamen", "geboortedatum", "geslacht", "bsn"] },
  belgium: { name: "Belgium", flag: "🇧🇪", colors: { primary: "#000000", secondary: "#fdda24", accent: "#ef3340", bg: "#fafafa" }, header: "BELGIË / BELGIQUE / BELGIEN", motto: "", type: "Identity Card / Carte d'Identité", fields: ["naam", "voornaam", "geboortedatum", "geslacht", "rijksregisternummer"] },
  switzerland: { name: "Switzerland", flag: "🇨🇭", colors: { primary: "#ff0000", secondary: "#ffffff", accent: "#ff0000", bg: "#fafafa" }, header: "Schweiz / Suisse / Svizzera", motto: "", type: "Ausweiskarte / Carte d'identité", fields: ["nachname", "vorname", "geburtsdatum", "geschlecht", "aw_nr"] },
  austria: { name: "Austria", flag: "🇦🇹", colors: { primary: "#ed2939", secondary: "#ffffff", accent: "#ed2939", bg: "#fafafa" }, header: "REPUBLIK ÖSTERREICH", motto: "", type: "Staatsbürgerschaftskarte", fields: ["nachname", "vorname", "geburtsdatum", "geschlecht", "dknr"] },
  sweden: { name: "Sweden", flag: "🇸🇪", colors: { primary: "#006aa7", secondary: "#fecc00", accent: "#006aa7", bg: "#fafafa" }, header: "KONUNGRIKET SVERIGE", motto: "", type: "Personlegitimation", fields: ["efternamn", "förnamn", "födelsedatum", "kön", "personnummer"] },
  norway: { name: "Norway", flag: "🇳🇴", colors: { primary: "#ba0c2f", secondary: "#00205b", accent: "#ffffff", bg: "#fafafa" }, header: "KONGERIKET NORGE", motto: "", type: "Nasjonal ID-kort", fields: ["etternavn", "fornavn", "fødselsdato", "kjønn", "fødselsnummer"] },
  denmark: { name: "Denmark", flag: "🇩🇰", colors: { primary: "#c8102e", secondary: "#ffffff", accent: "#c8102e", bg: "#fafafa" }, header: "DANMARK", motto: "", type: "CPR-Kort", fields: ["efternavn", "fornavn", "fødselsdato", "køn", "cpr-nummer"] },
  finland: { name: "Finland", flag: "🇫🇮", colors: { primary: "#003580", secondary: "#ffffff", accent: "#003580", bg: "#fafafa" }, header: "SUOMI / FINLAND", motto: "", type: "Henkilökortti / Carte d'identité", fields: ["sukunimi", "etunimi", "syntymäpäivä", " sukupuoli", "henkilötunnus"] },
  poland: { name: "Poland", flag: "🇵🇱", colors: { primary: "#dc143c", secondary: "#ffffff", accent: "#dc143c", bg: "#fafafa" }, header: "RZECZPOSPOLITA POLSKA", motto: "", type: "Dowód Osobisty", fields: ["nazwisko", "imiona", "data_urodzenia", "płeć", "numer_dowodu"] },
  czech: { name: "Czech Republic", flag: "🇨🇿", colors: { primary: "#11457e", secondary: "#d7141a", accent: "#ffffff", bg: "#fafafa" }, header: "ČESKÁ REPUBLIKA", motto: "", type: "Občanský průkaz", fields: ["příjmení", "jméno", "datum_narození", "pohlaví", "rodné_číslo"] },
  hungary: { name: "Hungary", flag: "🇭🇺", colors: { primary: "#ce2939", secondary: "#477050", accent: "#ffffff", bg: "#fafafa" }, header: "MAGYARORSZÁG", motto: "", type: "Személyi igazolvány", fields: ["vezetéknev", "utónév", "születési idő", "nem", "személyi azonosító"] },
  romania: { name: "Romania", flag: "🇷🇴", colors: { primary: "#002b7f", secondary: "#fcd116", accent: "#ce1126", bg: "#fafafa" }, header: "ROMÂNIA", motto: "", type: "Carte de Identitate", fields: ["nume", "prenume", "data_nașterii", "sex", "cnp"] },
  bulgaria: { name: "Bulgaria", flag: "🇧🇬", colors: { primary: "#00966e", secondary: "#d62612", accent: "#00966e", bg: "#fafafa" }, header: "РЕПУБЛИКА БЪЛГАРИЯ", motto: "", type: "Лична карта", fields: ["фамилия", "име", "дата_раждане", "пол", "ЕГН"] },
  greece: { name: "Greece", flag: "🇬🇷", colors: { primary: "#0d5eaf", secondary: "#ffffff", accent: "#0d5eaf", bg: "#fafafa" }, header: "ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ", motto: "", type: "Ταυτότητα", fields: ["επώνυμο", "όνομα", "ημερομηνία_γέννησης", "φύλο", "αριθμός_ταυτότητας"] },
  turkey: { name: "Turkey", flag: "🇹🇷", colors: { primary: "#e30a17", secondary: "#ffffff", accent: "#e30a17", bg: "#fafafa" }, header: "TÜRKİYE CUMHURİYETİ", motto: "", type: "Kimlik Kartı", fields: ["soyadı", "adı", "doğum_tarihi", "cinsiyet", "tck_no"] },
  
  // Americas
  usa: { name: "United States", flag: "🇺🇸", colors: { primary: "#3c3b6e", secondary: "#b22234", accent: "#ffffff", bg: "#fafafa" }, header: "UNITED STATES OF AMERICA", motto: "", type: "Driver's License / State ID", fields: ["last_name", "first_name", "date_of_birth", "sex", "license_no"] },
  canada: { name: "Canada", flag: "🇨🇦", colors: { primary: "#ff0000", secondary: "#ffffff", accent: "#ff0000", bg: "#fafafa" }, header: "CANADA", motto: "", type: "Provincial ID Card", fields: ["surname", "given_names", "date_of_birth", "sex", "id_number"] },
  mexico: { name: "Mexico", flag: "🇲🇽", colors: { primary: "#006847", secondary: "#ce1126", accent: "#fcd116", bg: "#fafafa" }, header: "ESTADOS UNIDOS MEXICANOS", motto: "", type: "CARTA DE IDENTIDAD CIUDADANA", fields: ["apellido_paterno", "apellido_materno", "nombre", "fecha_nacimiento", "sexo", "clave_electoral"] },
  brazil: { name: "Brazil", flag: "🇧🇷", colors: { primary: "#009c3b", secondary: "#ffdf00", accent: "#002776", bg: "#fafafa" }, header: "REPÚBLICA FEDERATIVA DO BRASIL", motto: "ORDEM E PROGRESSO", type: "Carteira de Identidade", fields: ["sobrenome", "nome", "data_nascimento", "sexo", "rg"] },
  argentina: { name: "Argentina", flag: "🇦🇷", colors: { primary: "#74acdf", secondary: "#ffffff", accent: "#74acdf", bg: "#fafafa" }, header: "REPÚBLICA ARGENTINA", motto: "", type: "Documento Nacional de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "dni"] },
  colombia: { name: "Colombia", flag: "🇨🇴", colors: { primary: "#fcd116", secondary: "#003893", accent: "#ce1126", bg: "#fafafa" }, header: "REPÚBLICA DE COLOMBIA", motto: "", type: "Cédula de Ciudadanía", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "numero_cedula"] },
  peru: { name: "Peru", flag: "🇵🇪", colors: { primary: "#d91023", secondary: "#ffffff", accent: "#d91023", bg: "#fafafa" }, header: "REPÚBLICA DEL PERÚ", motto: "", type: "Documento Nacional de Identidad", fields: ["apellido_paterno", "apellido_materno", "nombres", "fecha_nacimiento", "sexo", "dni"] },
  venezuela: { name: "Venezuela", flag: "🇻🇪", colors: { primary: "#cf142b", secondary: "#00247d", accent: "#ffcc00", bg: "#fafafa" }, header: "REPÚBLICA BOLIVARIANA DE VENEZUELA", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "cedula"] },
  chile: { name: "Chile", flag: "🇨🇱", colors: { primary: "#d52b1e", secondary: "#ffffff", accent: "#0039a6", bg: "#fafafa" }, header: "REPÚBLICA DE CHILE", motto: "", type: "Cédula de Identidad", fields: ["apellido_paterno", "apellido_materno", "nombres", "fecha_nacimiento", "sexo", "rut"] },
  ecuador: { name: "Ecuador", flag: "🇪🇨", colors: { primary: "#ffd100", secondary: "#0033a0", accent: "#ce1126", bg: "#fafafa" }, header: "REPÚBLICA DEL ECUADOR", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  bolivia: { name: "Bolivia", flag: "🇧🇴", colors: { primary: "#d52b1e", secondary: "#fcd116", accent: "#007934", bg: "#fafafa" }, header: "REPÚBLICA DE BOLIVIA", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  paraguay: { name: "Paraguay", flag: "🇵🇾", colors: { primary: "#d52b1e", secondary: "#0038a8", accent: "#ffffff", bg: "#fafafa" }, header: "REPÚBLICA DEL PARAGUAY", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  uruguay: { name: "Uruguay", flag: "🇺🇾", colors: { primary: "#0038a8", secondary: "#ffffff", accent: "#0038a8", bg: "#fafafa" }, header: "ORIENTALES Y REUNIDOS", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  costa_rica: { name: "Costa Rica", flag: "🇨🇷", colors: { primary: "#002b7f", secondary: "#ce1126", accent: "#ffffff", bg: "#fafafa" }, header: "REPÚBLICA DE COSTA RICA", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  panama: { name: "Panama", flag: "🇵🇦", colors: { primary: "#c8102e", secondary: "#003893", accent: "#ffffff", bg: "#fafafa" }, header: "REPÚBLICA DE PANAMÁ", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "cedula"] },
  guatemala: { name: "Guatemala", flag: "🇬🇹", colors: { primary: "#4997d0", secondary: "#ffffff", accent: "#4997d0", bg: "#fafafa" }, header: "REPÚBLICA DE GUATEMALA", motto: "", type: "Documento Personal ( DPI )", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "dpi"] },
  honduras: { name: "Honduras", flag: "🇭🇳", colors: { primary: "#0073cf", secondary: "#ffffff", accent: "#0073cf", bg: "#fafafa" }, header: "REPÚBLICA DE HONDURAS", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  el_salvador: { name: "El Salvador", flag: "🇸🇻", colors: { primary: "#0047a0", secondary: "#ffffff", accent: "#0047a0", bg: "#fafafa" }, header: "REPÚBLICA DE EL SALVADOR", motto: "", type: "Documento Personal", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "dpi"] },
  nicaragua: { name: "Nicaragua", flag: "🇳🇮", colors: { primary: "#0067c6", secondary: "#ffffff", accent: "#0067c6", bg: "#fafafa" }, header: "REPÚBLICA DE NICARAGUA", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "ci"] },
  dominican: { name: "Dominican Republic", flag: "🇩🇴", colors: { primary: "#003893", secondary: "#ce1126", accent: "#ffffff", bg: "#fafafa" }, header: "REPÚBLICA DOMINICANA", motto: "", type: "Cédula de Identidad", fields: ["apellido", "nombre", "fecha_nacimiento", "sexo", "cedula"] },
  haiti: { name: "Haiti", flag: "🇭🇹", colors: { primary: "#0018a8", secondary: "#d21034", accent: "#ffffff", bg: "#fafafa" }, header: "REPUBLIQUE D'HAITI", motto: "", type: "Carte d'Identité", fields: ["nom", "prenom", "date_naissance", "sexe", "n_carte"] },
  
  // Asia
  china: { name: "China", flag: "🇨🇳", colors: { primary: "#de2910", secondary: "#ffde00", accent: "#de2910", bg: "#fafafa" }, header: "中华人民共和国", motto: "", type: "居民身份证", fields: ["姓名", "性别", "民族", "出生日期", "地址", "公民身份证号"] },
  japan: { name: "Japan", flag: "🇯🇵", colors: { primary: "#bc002d", secondary: "#ffffff", accent: "#bc002d", bg: "#fafafa" }, header: "日本国", motto: "", type: "身分証明書", fields: ["姓", "名", "生年月日", "性別", "住所", "個人番号"] },
  korea: { name: "South Korea", flag: "🇰🇷", colors: { primary: "#cd2e3a", secondary: "#0047a0", accent: "#ffffff", bg: "#fafafa" }, header: "대한민국", motto: "", type: "신분증", fields: ["성명", "생년월일", "성별", "주소", "주민등록번호"] },
  india: { name: "India", flag: "🇮🇳", colors: { primary: "#ff9933", secondary: "#138808", accent: "#000080", bg: "#fafafa" }, header: "भारत / INDIA", motto: "SATYAMEVA JAYATE", type: "Aadhaar Card / Voter ID", fields: ["name", "date_of_birth", "gender", "address", "aadhaar_number"] },
  pakistan: { name: "Pakistan", flag: "🇵🇰", colors: { primary: "#01411c", secondary: "#ffffff", accent: "#01411c", bg: "#fafafa" }, header: "ISLAMIC REPUBLIC OF PAKISTAN", motto: "", type: "National Identity Card", fields: ["name", "father_name", "date_of_birth", "gender", "cnic"] },
  bangladesh: { name: "Bangladesh", flag: "🇧🇩", colors: { primary: "#006a4e", secondary: "#f42a4e", accent: "#006a4e", bg: "#fafafa" }, header: "গণপ্রজাতন্ত্রী বাংলাদেশ", motto: "", type: "জাতীয় পরিচয়পত্র", fields: ["name", "father_name", "mother_name", "date_of_birth", "n_id"] },
  indonesia: { name: "Indonesia", flag: "🇮🇩", colors: { primary: "#ff0000", secondary: "#ffffff", accent: "#ff0000", bg: "#fafafa" }, header: "REpublik INDONESIA", motto: "", type: "KTP (Kartu Tanda Penduduk)", fields: ["nama", "nik", "tempat_lahir", "tanggal_lahir", "jenis_kelamin", "alamat"] },
  malaysia: { name: "Malaysia", flag: "🇲🇾", colors: { primary: "#010066", secondary: "#cc0001", accent: "#ffd100", bg: "#fafafa" }, header: "MALAYSIA", motto: "", type: "MyKad", fields: ["nama", "kad_pengenalan", "tarikh_lahir", "jantina", "alamat"] },
  thailand: { name: "Thailand", flag: "🇹🇭", colors: { primary: "#a51931", secondary: "#f4f5f8", accent: "#2d2a4a", bg: "#fafafa" }, header: "ราชอาณาจักรไทย", motto: "", type: "บัตรประจำตัวประชาชน", fields: ["ชื่อ", "นามสกุล", "วันเดือนปีเกิด", "เพศ", "เลขบัตรประชาชน"] },
  vietnam: { name: "Vietnam", flag: "🇻🇳", colors: { primary: "#da251d", secondary: "#ffff00", accent: "#da251d", bg: "#fafafa" }, header: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", motto: "", type: "Căn cước công dân", fields: ["họ_tên", "ngày_sinh", "giới_tính", "địa_chỉ", "số_cccd"] },
  philippines: { name: "Philippines", flag: "🇵🇭", colors: { primary: "#0038a8", secondary: "#ce1126", accent: "#fcd116", bg: "#fafafa" }, header: "REPUBLIKA NG PILIPINAS", motto: "", type: "National ID (PhilID)", fields: ["last_name", "first_name", "date_of_birth", "sex", "philid_number"] },
  singapore: { name: "Singapore", flag: "🇸🇬", colors: { primary: "#c8102e", secondary: "#ffffff", accent: "#c8102e", bg: "#fafafa" }, header: "REPUBLIK SINGAPURA", motto: "", type: "NRIC / Identity Card", fields: ["name", "nrpc_no", "date_of_birth", "race", "nationality", "address"] },
  sri_lanka: { name: "Sri Lanka", flag: "🇱🇰", colors: { primary: "#8a1530", secondary: "#ffbe24", accent: "#204b8a", bg: "#fafafa" }, header: "ශ්‍රී ලංකා ප්‍රජාතාන්ත්‍රික සමූහාධිපති රට", motto: "", type: "NIC", fields: ["name", "nic_number", "date_of_birth", "gender", "address"] },
  
  // Middle East
  saudi_arabia: { name: "Saudi Arabia", flag: "🇸🇦", colors: { primary: "#006c35", secondary: "#ffffff", accent: "#006c35", bg: "#fafafa" }, header: "المملكة العربية السعودية", motto: "", type: "هوية وطنية", fields: ["الاسم", "تاريخ_الميلاد", "الجنس", "رقم_الهوية", "العنوان"] },
  uae: { name: "UAE", flag: "🇦🇪", colors: { primary: "#00732f", secondary: "#ffffff", accent: "#ff0000", bg: "#fafafa" }, header: "الإمارات العربية المتحدة", motto: "", type: "بطاقة الهوية", fields: ["الاسم", "تاريخ_الميلاد", "الجنس", "رقم_الهوية", "الإقامة"] },
  israel: { name: "Israel", flag: "🇮🇱", colors: { primary: "#0038b8", secondary: "#ffffff", accent: "#0038b8", bg: "#fafafa" }, header: "מדינת ישראל", motto: "", type: "תעודת זהות", fields: ["שם", "תאריך_לידה", "מין", "ת.ז"] },
  iran: { name: "Iran", flag: "🇮🇷", colors: { primary: "#239f40", secondary: "#ffffff", accent: "#da0000", bg: "#fafafa" }, header: "جمهوری اسلامی ایران", motto: "", type: "کارت ملی", fields: ["نام", "نام_خانوادگی", "تاریخ_تولد", "جنسیت", "کد_ملی"] },
  turkey_mena: { name: "Turkey", flag: "🇹🇷", colors: { primary: "#e30a17", secondary: "#ffffff", accent: "#e30a17", bg: "#fafafa" }, header: "TÜRKİYE CUMHURİYETİ", motto: "", type: "Kimlik Kartı", fields: ["soyadı", "adı", "doğum_tarihi", "cinsiyet", "tck_no"] },
  
  // Oceania
  australia: { name: "Australia", flag: "🇦🇺", colors: { primary: "#00008b", secondary: "#ffffff", accent: "#ff0000", bg: "#fafafa" }, header: "AUSTRALIA", motto: "", type: "Driving Licence / ID Card", fields: ["surname", "given_names", "date_of_birth", "sex", "licence_no"] },
  new_zealand: { name: "New Zealand", flag: "🇳🇿", colors: { primary: "#00247d", secondary: "#cc142b", accent: "#ffffff", bg: "#fafafa" }, header: "NEW ZEALAND", motto: "", type: "Driver Licence / Identity Card", fields: ["surname", "given_names", "date_of_birth", "sex", "licence_no"] },
  
  // Default fallback
  default: { name: "National ID", flag: "🏳️", colors: { primary: "#0066cc", secondary: "#cc0000", accent: "#ffcc00", bg: "#f5f5f5" }, header: "NATIONAL IDENTITY CARD", motto: "", type: "Identity Card", fields: ["last_name", "first_name", "date_of_birth", "sex", "id_number"] }
};

const WIDTH = 856;
const HEIGHT = 540;

function detectCountry(query) {
  const lower = (query || "").toLowerCase();
  
  const keyMap = {
    "cameroon": "cameroon", "cmr": "cameroon", "yaounde": "cameroon",
    "nigeria": "nigeria", "ng": "nigeria", "lagos": "nigeria", "abuja": "nigeria",
    "ghana": "ghana", "gh": "ghana", "accra": "ghana",
    "senegal": "senegal", "sn": "senegal", "dakar": "senegal",
    "ivory coast": "ivory_coast", "cote d'ivoire": "ivory_coast", "ci": "ivory_coast", "abidjan": "ivory_coast",
    "togo": "togo", "tg": "togo", "lome": "togo",
    "benin": "benin", "bj": "benin", "porto-novo": "benin",
    "burkina faso": "burkina_faso", "bf": "burkina_faso", "ouagadougou": "burkina_faso",
    "mali": "mali", "ml": "mali", "bamako": "mali",
    "guinea": "guinea", "gn": "guinea", "conakry": "guinea",
    "cape verde": "cape_verde", "cv": "cape_verde",
    "congo": "congo", "cg": "congo", "brazzaville": "congo",
    "dr congo": "dr_congo", "drc": "dr_congo", "kinshasa": "dr_congo",
    "gabon": "gabon", "ga": "gabon", "libreville": "gabon",
    "guinea-bissau": "guinea_bissau", "gw": "guinea_bissau",
    "liberia": "liberia", "lr": "liberia", "monrovia": "liberia",
    "mauritania": "mauritania", "mr": "mauritania", "nouakchott": "mauritania",
    "mauritius": "mauritius", "mu": "mauritius", "port louis": "mauritius",
    "sao tome": "sao_tome", "st": "sao_tome",
    "sierra leone": "sierra_leone", "sl": "sierra_leone", "freetown": "sierra_leone",
    "zambia": "zambia", "zm": "zambia", "lusaka": "zambia",
    "france": "france", "fr": "france", "paris": "france",
    "germany": "germany", "de": "germany", "berlin": "germany", "deutschland": "germany",
    "uk": "uk", "united kingdom": "uk", "britain": "uk", "london": "uk", "england": "uk",
    "spain": "spain", "es": "spain", "madrid": "spain",
    "italy": "italy", "it": "italy", "rome": "italy",
    "portugal": "portugal", "pt": "portugal", "lisbon": "portugal",
    "netherlands": "netherlands", "nl": "netherlands", "amsterdam": "netherlands", "holland": "netherlands",
    "belgium": "belgium", "be": "belgium", "brussels": "belgium",
    "switzerland": "switzerland", "ch": "switzerland", "zurich": "switzerland",
    "austria": "austria", "at": "austria", "vienna": "austria",
    "sweden": "sweden", "se": "sweden", "stockholm": "sweden",
    "norway": "norway", "no": "norway", "oslo": "norway",
    "denmark": "denmark", "dk": "denmark", "copenhagen": "denmark",
    "finland": "finland", "fi": "finland", "helsinki": "finland",
    "poland": "poland", "pl": "poland", "warsaw": "poland",
    "czech": "czech", "czech republic": "czech", "cz": "czech", "prague": "czech",
    "hungary": "hungary", "hu": "hungary", "budapest": "hungary",
    "romania": "romania", "ro": "romania", "bucharest": "romania",
    "bulgaria": "bulgaria", "bg": "bulgaria", "sofia": "bulgaria",
    "greece": "greece", "gr": "greece", "athens": "greece",
    "turkey": "turkey", "tr": "turkey", "istanbul": "turkey",
    "usa": "usa", "united states": "usa", "america": "usa", "american": "usa", "us": "usa",
    "canada": "canada", "ca": "canada", "toronto": "canada", "vancouver": "canada",
    "mexico": "mexico", "mx": "mexico", "mexico city": "mexico",
    "brazil": "brazil", "br": "brazil", "rio": "brazil", "sao paulo": "brazil",
    "argentina": "argentina", "ar": "argentina", "buenos aires": "argentina",
    "colombia": "colombia", "co": "colombia", "bogota": "colombia",
    "peru": "peru", "pe": "peru", "lima": "peru",
    "venezuela": "venezuela", "ve": "venezuela", "caracas": "venezuela",
    "chile": "chile", "cl": "chile", "santiago": "chile",
    "ecuador": "ecuador", "ec": "ecuador", "quito": "ecuador",
    "bolivia": "bolivia", "bo": "bolivia", "la paz": "bolivia",
    "paraguay": "paraguay", "py": "paraguay", "asuncion": "paraguay",
    "uruguay": "uruguay", "uy": "uruguay", "montevideo": "uruguay",
    "costa rica": "costa_rica", "cr": "costa_rica",
    "panama": "panama", "pa": "panama", "panama city": "panama",
    "guatemala": "guatemala", "gt": "guatemala",
    "honduras": "honduras", "hn": "honduras",
    "el salvador": "el_salvador", "sv": "el_salvador",
    "nicaragua": "nicaragua", "ni": "nicaragua",
    "dominican republic": "dominican", "do": "dominican",
    "haiti": "haiti", "ht": "haiti",
    "china": "china", "cn": "china", "chinese": "china",
    "japan": "japan", "jp": "japan", "japanese": "japan",
    "korea": "korea", "kr": "korea", "south korea": "korea",
    "india": "india", "in": "india", "indian": "india",
    "pakistan": "pakistan", "pk": "pakistan",
    "bangladesh": "bangladesh", "bd": "bangladesh",
    "indonesia": "indonesia", "id": "indonesia", "indonesian": "indonesia",
    "malaysia": "malaysia", "my": "malaysia",
    "thailand": "thailand", "th": "thailand", "thai": "thailand",
    "vietnam": "vietnam", "vn": "vietnam", "vietnamese": "vietnam",
    "philippines": "philippines", "ph": "philippines", "filipino": "philippines",
    "singapore": "singapore", "sg": "singapore",
    "sri lanka": "sri_lanka", "lk": "sri_lanka",
    "saudi arabia": "saudi_arabia", "sa": "saudi_arabia",
    "uae": "uae", " Duba": "uae", "abu dhabi": "uae",
    "israel": "israel", "il": "israel",
    "iran": "iran", "ir": "iran",
    "australia": "australia", "au": "australia", "sydney": "australia",
    "new zealand": "new_zealand", "nz": "new zealand"
  };
  
  for (const [key, value] of Object.entries(keyMap)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

function extractDetails(text, countryKey) {
  const country = COUNTRIES[countryKey] || COUNTRIES.default;
  const details = {};
  
  for (const field of country.fields) {
    details[field] = "";
  }
  
  const lines = String(text || "").split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    for (const field of country.fields) {
      if (lower.includes(field.replace(/_/g, ' ')) || lower.includes(field)) {
        const value = line.replace(new RegExp(`.*[:\\s]*`), "").trim();
        if (value && value !== field) {
          details[field] = value;
        }
      }
    }
  }
  
  return details;
}

function getMissingFields(details, countryKey) {
  const country = COUNTRIES[countryKey] || COUNTRIES.default;
  return country.fields.filter(f => !details[f]);
}

function autoGenerateIdNumber(countryKey) {
  const country = COUNTRIES[countryKey] || COUNTRIES.default;
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 900000) + 100000;
  
  const formats = {
    cameroon: 'CMR' + ts + rand.toString().slice(0, 3),
    nigeria: (10000000000 + Math.floor(Math.random() * 9000000000)).toString(),
    ghana: 'GHA' + rand.toString().slice(0, 9),
    france: rand.toString().padStart(9, '0'),
    germany: (10000000000 + Math.floor(Math.random() * 9000000000)).toString(),
    usa: (100000000 + Math.floor(Math.random() * 900000000)).toString(),
    china: (10000000000000000 + Math.floor(Math.random() * 9000000000000000)).toString(),
    japan: (1000000000 + Math.floor(Math.random() * 9000000000)).toString(),
    brazil: (10000000000 + Math.floor(Math.random() * 9000000000)).toString(),
    india: (10000000000 + Math.floor(Math.random() * 9000000000)).toString()
  };
  
  return formats[countryKey] || formats.cameroon || ts + rand;
}

function generateIdCard(imageBuffer, details, countryKey = "default") {
  const country = COUNTRIES[countryKey] || COUNTRIES.default;
  const { colors, header, motto, type, fields } = country;
  
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  
  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  
  // Border
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, WIDTH - 12, HEIGHT - 12);
  ctx.strokeStyle = colors.secondary;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, WIDTH - 28, HEIGHT - 28);
  
  // Header bar
  ctx.fillStyle = colors.primary;
  ctx.fillRect(0, 0, WIDTH, 90);
  
  // Header text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.fillText(header, WIDTH / 2, 35);
  
  if (motto) {
    ctx.font = "13px Arial";
    ctx.fillText(motto, WIDTH / 2, 65);
  }
  
  // Card type
  ctx.font = "bold 18px Arial";
  ctx.fillStyle = colors.secondary;
  ctx.fillText(type, WIDTH / 2, 110);
  
  // Photo area
  const photoX = 40, photoY = 130, photoW = 180, photoH = 220;
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 3;
  ctx.strokeRect(photoX, photoY, photoW, photoH);
  
  // Photo placeholder
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.arc(photoX + photoW/2, photoY + photoH/2 - 25, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(photoX + photoW/2 - 30, photoY + photoH/2 + 10, 60, 45);
  
  // Details
  let yPos = 140;
  ctx.textAlign = "left";
  
  for (const field of fields) {
    const value = details[field] || "_".repeat(15);
    
    ctx.font = "12px Arial";
    ctx.fillStyle = "#666";
    ctx.fillText(field.replace(/_/g, ' '), 260, yPos);
    
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "#000";
    ctx.fillText(String(value).slice(0, 35), 260, yPos + 25);
    
    yPos += 50;
  }
  
  // Bottom stripe
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(0, HEIGHT - 30, WIDTH, 15);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, HEIGHT - 15, WIDTH, 15);
  
  // Flag
  ctx.font = "36px Arial";
  ctx.textAlign = "right";
  ctx.fillText(country.flag || "", WIDTH - 30, HEIGHT - 50);
  
  // Watermark
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.font = "bold 70px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = colors.primary;
  ctx.translate(WIDTH/2, HEIGHT/2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillText(type, 0, 0);
  ctx.restore();
  
  return canvas.toBuffer("image/jpeg", { quality: 0.9 });
}

module.exports = { generateIdCard, extractDetails, getMissingFields, detectCountry, autoGenerateIdNumber, COUNTRIES, WIDTH, HEIGHT };
