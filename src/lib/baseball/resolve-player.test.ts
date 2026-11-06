import { describe, expect, it } from "vitest";
import type { BaseballPlayer, PlayersDataset } from "@/types/baseball";
import { createPlayerIndex, getPlayerIndex } from "./dataset";
import { maxTypoDistance, resolvePlayerName, type NameResolution } from "./resolve-player";

const real = getPlayerIndex();
const resolve = (input: string) => resolvePlayerName(input, real);
/** Resolved id, the sorted namesake ids, or the kind. */
const idOf = (r: NameResolution) =>
  r.kind === "resolved" ? r.player.id : r.kind === "namesakes" ? r.players.map((p) => p.id).sort().join(",") : r.kind;
const suggestionFor = (input: string) => {
  const r = resolve(input);
  return r.kind === "suggestion" ? r : undefined;
};

describe("resolvePlayerName — real Lahman data", () => {
  it("handles the documented examples", () => {
    expect(idOf(resolve("Griffey"))).toBe("ambiguous");
    expect(idOf(resolve("Ken Griffey Jr."))).toBe("griffke02");
    expect(idOf(resolve("Ken Griffey Sr."))).toBe("griffke01");
    expect(idOf(resolve("Rodriguez"))).toBe("ambiguous");
    expect(idOf(resolve("Alex Rodriguez"))).toBe("rodrial01");
    expect(idOf(resolve("Ichiro"))).toBe("suzukic01");
    expect(idOf(resolve("Ohtani"))).toBe("ohtansh01");
  });

  it("recognizes exact full names", () => {
    expect(resolve("Babe Ruth")).toMatchObject({ kind: "resolved", matchType: "exact" });
    expect(idOf(resolve("  derek   JETER "))).toBe("jeterde01");
  });

  it("recognizes accented and unaccented spellings", () => {
    expect(idOf(resolve("Raúl Ibañez"))).toBe("ibanera01"); // Lahman: "Raul Ibanez"
    expect(idOf(resolve("Ronald Acuna"))).toBe("acunaro01"); // Lahman: "Ronald Acuña"
  });

  it("recognizes verified aliases", () => {
    expect(resolve("Big Papi")).toMatchObject({ kind: "resolved", matchType: "alias" });
    expect(idOf(resolve("Big Papi"))).toBe("ortizda01");
    expect(idOf(resolve("Goose Gossage"))).toBe("gossari01");
    expect(idOf(resolve("Lance McCullers Jr."))).toBe("mcculla02");
  });

  it("tolerates missing punctuation without needing a correction", () => {
    expect(resolve("Paul ONeill")).toMatchObject({ kind: "resolved", matchType: "exact" });
  });

  it("turns minor spelling mistakes into a suggestion, never an automatic match", () => {
    const cases: Array<[string, string, string]> = [
      ["Shohei Otani", "ohtansh01", "Shohei Ohtani"], // missing letter
      ["Derek Jeeter", "jeterde01", "Derek Jeter"], // extra letter
      ["Mike Truot", "troutmi01", "Mike Trout"], // transposition
      ["Albert Pujolz", "pujolal01", "Albert Pujols"], // substitution
      ["Ken Grifey Jr", "griffke02", "Ken Griffey Jr."], // keeps the alias that identifies Junior
      ["Ohtnai", "ohtansh01", "Ohtani"], // unique surname typo
    ];
    for (const [input, id, suggestion] of cases) {
      expect(resolve(input), input).toMatchObject({ kind: "suggestion", suggestion, playerIds: [id] });
    }
  });

  it("suggests the correct spelling of a shared name", () => {
    const r = suggestionFor("Randy Jonson");
    expect(r?.suggestion).toBe("Randy Johnson");
    expect(r?.playerIds.sort()).toEqual(["johnsra03", "johnsra04", "johnsra05"]);
  });

  it("only suggests text that resolves to the same players without correction", () => {
    for (const input of [
      "Shohei Otani", "Derek Jeeter", "Mike Truot", "Ken Grifey Jr", "Ohtnai", "Randy Jonson", "Ken Grifey",
    ]) {
      const s = suggestionFor(input)!;
      const again = resolve(s.suggestion);
      expect(["resolved", "namesakes"], `${input} → ${s.suggestion}`).toContain(again.kind);
      expect(idOf(again)).toBe([...s.playerIds].sort().join(","));
    }
  });

  it("accepts a surname or first name that identifies exactly one player", () => {
    expect(resolve("Buhner")).toMatchObject({ kind: "resolved", matchType: "partial" });
    expect(idOf(resolve("Kiner-Falefa"))).toBe("kineris01"); // multi-word surname
    expect(idOf(resolve("Shohei"))).toBe("ohtansh01");
  });

  it("rejects shared surnames and first names as ambiguous", () => {
    for (const input of ["Jeter", "Pujols", "Cobb", "Johnson", "Mike", "JD"]) {
      expect(resolve(input).kind, input).toBe("ambiguous");
    }
  });

  it("returns every namesake for a shared full name, leaving the choice to the question", () => {
    expect(resolve("Randy Johnson")).toMatchObject({ kind: "namesakes", matchType: "exact" });
    expect(idOf(resolve("Randy Johnson"))).toBe("johnsra03,johnsra04,johnsra05");
    expect(idOf(resolve("Luis Castillo"))).toBe("castilu01,castilu02,castilu03");
  });

  describe("father/son namesakes", () => {
    it("resolves straight to Sr. when no suffix is typed", () => {
      const cases: Array<[string, string]> = [
        ["Ken Griffey", "griffke01"],
        ["Fernando Tatis", "tatisfe01"],
        ["Vladimir Guerrero", "guerrvl01"],
        ["Vlad Guerrero", "guerrvl01"],
        ["Pete Rose", "rosepe01"],
        ["Bobby Witt", "wittbo01"],
      ];
      for (const [input, id] of cases) {
        expect(resolve(input), input).toMatchObject({ kind: "resolved", player: { id } });
      }
    });

    it("also suggests Sr. for a misspelled plain name", () => {
      expect(resolve("Ken Grifey")).toMatchObject({ kind: "suggestion", suggestion: "Ken Griffey Sr." });
    });

    it("only reaches Jr. when Jr. is typed", () => {
      expect(idOf(resolve("Ken Griffey Jr"))).toBe("griffke02");
      expect(idOf(resolve("Fernando Tatis Jr."))).toBe("tatisfe02");
      expect(resolve("Ken Grifey Jr")).toMatchObject({ kind: "suggestion", suggestion: "Ken Griffey Jr." });
    });

    it("reaches the Negro Leagues Eddie Collins only through his alias", () => {
      expect(idOf(resolve("Eddie Collins"))).toBe("collied01");
      expect(idOf(resolve("Eddie Collins Jr."))).toBe("collied02");
      expect(resolve("Eddie Collins (Negro Leagues)")).toMatchObject({ kind: "resolved", player: { id: "collied03" } });
      expect(idOf(resolve("eddie collins negro leagues"))).toBe("collied03");
    });

    it("every Jr./Sr./III alias pair resolves both ways, and the plain name means the father", () => {
      const pairs: Array<[string, string, string]> = [
        ["Gary Matthews", "matthga01", "matthga02"],
        ["Billy Sullivan", "sullibi03", "sullibi04"],
        ["Delino DeShields", "deshide01", "deshide02"],
        ["Pedro Borbon", "borbope01", "borbope02"],
        ["Ozzie Virgil", "virgioz01", "virgioz02"],
        ["Jim Bagby", "bagbyji01", "bagbyji02"],
        ["Steve Lombardozzi", "lombast01", "lombast02"],
        ["Mark Leiter", "leitema01", "leitema02"],
        ["Ivan De Jesus", "dejesiv01", "dejesiv02"],
        ["Ed Sprague", "spraged01", "spraged02"],
        ["Tony Armas", "armasto01", "armasto02"],
        ["Dwight Smith", "smithdw01", "smithdw02"],
        ["Eric Young", "younger01", "younger03"],
        ["John Mayberry", "maybejo01", "maybejo02"],
        ["Hal Trosky", "troskha01", "troskha02"],
        ["Ed Walsh", "walshed01", "walshed02"],
        ["Lew Krausse", "krausle01", "krausle02"],
        ["Chet Nichols", "nichoch01", "nichoch02"],
        ["Glenn Liebhardt", "liebhgl01", "liebhgl02"],
        ["Charlie Beamon", "beamoch01", "beamoch02"],
        ["Earl Averill", "averiea01", "averiea02"],
        ["Joe Schultz", "schuljo03", "schuljo05"],
      ];
      for (const [name, sr, jr] of pairs) {
        expect(resolve(name), name).toMatchObject({ kind: "resolved", player: { id: sr } });
        expect(resolve(`${name} Sr.`), `${name} Sr.`).toMatchObject({ kind: "resolved", player: { id: sr } });
        expect(resolve(`${name} Jr.`), `${name} Jr.`).toMatchObject({ kind: "resolved", player: { id: jr } });
      }
      // Accents and missing punctuation still reach the alias.
      expect(idOf(resolve("Pedro Borbón Jr"))).toBe("borbope02");
      expect(idOf(resolve("Iván De Jesús Jr."))).toBe("dejesiv02");
    });

    it("Jr.-only names: the plain name stays a choice between namesakes", () => {
      expect(idOf(resolve("Tony Pena Jr."))).toBe("penato02");
      expect(resolve("Tony Peña")).toMatchObject({ kind: "namesakes" });
      expect(idOf(resolve("Lyman Bostock Jr."))).toBe("bostoly01");
      expect(resolve("Lyman Bostock")).toMatchObject({ kind: "namesakes" });
      expect(idOf(resolve("Roy Smalley Jr."))).toBe("smallro01");
      expect(idOf(resolve("Roy Smalley III"))).toBe("smallro02");
      expect(resolve("Roy Smalley")).toMatchObject({ kind: "namesakes" });
    });

    it("resolves an explicit Sr. directly", () => {
      expect(resolve("Ken Griffey Sr")).toMatchObject({ kind: "resolved", player: { id: "griffke01" } });
    });

    it("does not apply to surnames alone", () => {
      expect(resolve("Griffey").kind).toBe("ambiguous");
    });
  });

  it("never lets fuzzy matching override an exact name", () => {
    // Jim Rice and Jim Price are different real players one edit apart.
    expect(idOf(resolve("Jim Rice"))).toBe("riceji01");
    expect(idOf(resolve("Jim Price"))).toBe("priceji01");
  });

  it("does not fuzzy-match short names", () => {
    expect(resolve("Ruht").kind).toBe("unrecognized");
    expect(resolve("Cob").kind).toBe("unrecognized");
  });

  it("reports gibberish as unrecognized", () => {
    expect(resolve("Xyzabc").kind).toBe("unrecognized");
    expect(resolve("").kind).toBe("unrecognized");
    expect(resolve("!!!").kind).toBe("unrecognized");
  });

  it("does not treat team names as part of the answer", () => {
    expect(resolve("Randy Johnson Mariners").kind).toBe("unrecognized");
  });
});

describe("maxTypoDistance", () => {
  it("is stricter for shorter names", () => {
    expect(maxTypoDistance(4)).toBe(0);
    expect(maxTypoDistance(6)).toBe(1);
    expect(maxTypoDistance(12)).toBe(2);
  });
});

describe("resolvePlayerName — isolated fixture", () => {
  const player = (id: string, first: string, last: string): BaseballPlayer => ({
    id, name: `${first} ${last}`, lastName: last, firstYear: 2000, lastYear: 2005, seasons: [[2000, 2005]], games: 100,
    teams: ["AAA"], franchises: ["AAA"], positions: {}, career: {}, bestSeason: {}, mvp: [], cyYoung: [], hof: null,
    allStar: [], wsTitles: [], birthCountry: null, birthState: null,
  });
  const fixture: PlayersDataset = {
    meta: { source: "test", sourceUrl: "", release: "", license: "", playerCount: 5 },
    teams: { AAA: "Springfield Isotopes" },
    franchises: { AAA: "Springfield Isotopes" },
    players: [
      player("barkeal01", "Alan", "Barker"),
      player("parkeal01", "Alan", "Parker"),
      player("hillsa01", "Sam", "Hill"),
      player("hillsa02", "Sam", "Hill"),
      player("zimmequ01", "Quentin", "Zimmerly"),
    ],
  };
  const index = createPlayerIndex(fixture, [["Q-Zim", "zimmequ01"]]);
  const r = (s: string) => idOf(resolvePlayerName(s, index));

  it("rejects a typo that is equally close to two different names", () => {
    expect(r("Alan Darker")).toBe("ambiguous"); // one edit from both Barker and Parker
  });

  it("suggests the name a typo is clearly closest to", () => {
    // 1 edit from Barker, 2 from Parker
    expect(resolvePlayerName("Alan Barkr", index)).toMatchObject({ kind: "suggestion", suggestion: "Alan Barker" });
  });

  it("prefers exact names over close neighbours", () => {
    expect(r("Alan Parker")).toBe("parkeal01");
  });

  it("returns namesakes for a shared full name and ambiguity for a shared surname", () => {
    expect(r("Sam Hill")).toBe("hillsa01,hillsa02");
    expect(r("Hill")).toBe("ambiguous");
    expect(r("Zimmerly")).toBe("zimmequ01");
    expect(r("Quentin")).toBe("zimmequ01");
  });

  it("supports aliases", () => {
    expect(r("q zim")).toBe("zimmequ01");
  });
});
