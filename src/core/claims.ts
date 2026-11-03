/**
 * Heuristic checks over text written by a model. They catch the common ways a generated profile
 * could assert something the owner never declared. They do not prove truth: the owner's explicit
 * approval, on the exact digest, remains the control. Decision 12 and semantic contract section 5.
 */
const SUPERLATIVE=/\b(the only|the best|best[- ]in[- ]class|industry[- ]leading|market[- ]leading|leading provider|market leader|largest|biggest|number one|top[- ]rated|world[- ]class|unmatched|unrivall?ed|guarantee[sd]?|most trusted)\b|#1\b|\b(los|las|el|la) [uú]nic[oa]s?\b|\b[uú]nic[oa]s? (del|en el|en la)\b|\b(el|la|los|las) mejor(es)?\b|\bl[ií]der(es)? (del|en)\b|\bm[aá]s grande\b|\bn[uú]mero uno\b|\bgarantiza\w*\b/i;
const CREDENTIAL=/\b(certified|certification|accredited|accreditation|licensed|award[- ]?winning|awarded|iso[ -]?\d{3,5}|soc[ -]?2|hipaa|years of experience|clients include|trusted by|certificad[oa]s?|certificaci[oó]n(es)?|acreditad[oa]s?|premiad[oa]s?|galardonad[oa]s?|a[nñ]os de experiencia|clientes como)\b/gi;
const PROPER=/(^|[^.!?:]\s)([\p{Lu}][\p{L}\p{N}&-]+)/gu;
const NUMBER=/\d[\d.,]*\d|\d/g;

export function findUnsupportedClaims(text:string):string[] {
  const found:string[]=[];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) if (SUPERLATIVE.test(sentence)) found.push(sentence.trim());
  return found;
}
const norm=(s:string)=>s.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
export interface ClaimViolation {rule:'superlative'|'credential'|'number'|'proper_noun';value:string;}
/** Every violation names what generated text added beyond the declared corpus. */
export function checkGeneratedText(text:string,corpus:string):ClaimViolation[] {
  const source=norm(corpus);const violations:ClaimViolation[]=[];
  const superlative=text.match(SUPERLATIVE);
  if (superlative) violations.push({rule:'superlative',value:superlative[0]});
  for (const m of text.matchAll(CREDENTIAL)) if (!source.includes(norm(m[0]))) violations.push({rule:'credential',value:m[0]});
  for (const m of text.match(NUMBER)??[]) if (!source.includes(norm(m))) violations.push({rule:'number',value:m});
  for (const m of text.matchAll(PROPER)) {
    const word=m[2]!;
    if (!source.includes(norm(word))) violations.push({rule:'proper_noun',value:word});
  }
  return violations;
}
