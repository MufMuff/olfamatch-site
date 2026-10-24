/*
 * E-mails en texte simple (MIME écrit à la main, sans dépendance).
 */

export function enBase64(chaine) {
  const octets = new TextEncoder().encode(chaine);
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

// Sujet en UTF-8 (RFC 2047), en morceaux de 45 octets au plus pour rester sous 76 caractères par ligne.
export function encoderSujet(sujet) {
  const morceaux = [];
  let courant = "";
  for (const caractere of sujet) {
    if (new TextEncoder().encode(courant + caractere).length > 45) { morceaux.push(courant); courant = ""; }
    courant += caractere;
  }
  if (courant) morceaux.push(courant);
  return morceaux.map(m => `=?UTF-8?B?${enBase64(m)}?=`).join("\r\n ");
}

export function messageBrut({ de, a, sujet, corps, date = new Date(), id = crypto.randomUUID() }) {
  const domaine = String(de).split("@")[1] || "olfamatch.invalid";
  const corps64 = enBase64(corps.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, ligne => `${ligne}\r\n`);
  return [
    `From: Olfamatch <${de}>`,
    `To: <${a}>`,
    `Subject: ${encoderSujet(sujet)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domaine}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    corps64,
  ].join("\r\n");
}
