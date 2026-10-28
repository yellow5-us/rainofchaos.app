import unittest

import rates

C = "Metadata/Items/Currency/CurrencyRerollRare"
D = "Metadata/Items/Currency/CurrencyModValues"
V = "Metadata/Items/Currency/HarvestSeedGreen"
P = "Metadata/Items/Currency/HarvestSeedBlue"
X = "Metadata/Items/Currency/SomethingUntracked"
H = 1_791_050_400


def market(league, a, b, vol_a, vol_b, low=(1, 1), high=(1, 1), stock=(1, 1), top=None):
    top = top or stock  # highest stock over the hour; the lowest is `stock`
    return {
        "league": league,
        "market_pair": [a, b],
        "volume_traded": {a: vol_a, b: vol_b},
        "lowest_stock": {a: stock[0], b: stock[1]},
        "highest_stock": {a: top[0], b: top[1]},
        "lowest_ratio": {a: low[0], b: low[1]},
        "highest_ratio": {a: high[0], b: high[1]},
    }


class FakeApi:
    """Serves one page per hour from `pages`; the hour after the last is 'not finished yet'."""

    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def __call__(self, change_id):
        self.calls.append(change_id)
        if change_id in self.pages:
            return {"next_change_id": change_id + rates.HOUR, "markets": self.pages[change_id]}
        return {"next_change_id": change_id, "markets": []}


class MergeTests(unittest.TestCase):
    def test_tracks_any_currency_against_chaos_or_divine(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [
            market("Allflame", C, D, 1160810, 3051),
            market("Allflame", C, X, 10, 10),
        ]})
        pairs = state["leagues"]["Allflame"]["pairs"]
        self.assertEqual(sorted(pairs), ["CurrencyModValues|CurrencyRerollRare", "CurrencyRerollRare|SomethingUntracked"])
        p = pairs["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["a"], p["b"], p["volA"], p["volB"], p["hour"]), ("CurrencyRerollRare", "CurrencyModValues", 1160810, 3051, H))

    def test_skips_private_and_ruthless_leagues(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Ruthless Allflame", C, D, 380, 1), market("Guild (PL123)", C, D, 380, 1)]})
        self.assertEqual(state["leagues"], {})

    def test_rates_view_drops_history(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Allflame", C, D, 380, 1)]})
        rates.prune(state, H + rates.HOUR)
        p = rates.rates_view(state)["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertNotIn("history", p)
        self.assertEqual((p["dayA"], p["dayB"]), (380, 1))
        self.assertIn("history", state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"])

    def test_skips_pairs_without_trades_on_both_sides(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Allflame", C, V, 0, 50)]})
        self.assertEqual(state["leagues"], {})

    def test_older_hour_never_overwrites_newer(self):
        state = rates.empty_state()
        rates.merge_page(state, H + rates.HOUR, {"markets": [market("Allflame", C, D, 380, 1)]})
        rates.merge_page(state, H, {"markets": [market("Allflame", C, D, 999, 1)]})
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["volA"], p["hour"]), (380, H + rates.HOUR))

    def test_skips_pairs_between_two_items(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Allflame", V, P, 8575, 1039), market("Allflame", V, C, 8, 1)]})
        self.assertEqual(list(state["leagues"]["Allflame"]["pairs"]), ["CurrencyRerollRare|HarvestSeedGreen"])

    def test_prune_drops_item_to_item_pairs_already_stored(self):
        state = rates.empty_state()
        state["leagues"]["Allflame"] = {"kind": "challenge-softcore", "chaosVolume": 0, "pairs": {
            "HarvestSeedBlue|HarvestSeedGreen": {"a": "HarvestSeedGreen", "b": "HarvestSeedBlue", "hour": H},
            "CurrencyRerollRare|HarvestSeedGreen": {"a": "HarvestSeedGreen", "b": "CurrencyRerollRare", "hour": H},
        }}
        rates.prune(state, H + rates.HOUR)
        self.assertEqual(list(state["leagues"]["Allflame"]["pairs"]), ["CurrencyRerollRare|HarvestSeedGreen"])

    def test_day_totals_sum_every_hour_in_the_last_24h(self):
        state = rates.empty_state()
        for i, (vc, vd) in enumerate([(380, 1), (760, 2), (1140, 3)]):
            rates.merge_page(state, H + i * rates.HOUR, {"markets": [market("Allflame", C, D, vc, vd)]})
        rates.prune(state, H + 3 * rates.HOUR)
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["volA"], p["volB"]), (1140, 3), "latest hour")
        self.assertEqual((p["dayA"], p["dayB"]), (2280, 6), "24h totals")

    def test_day_totals_drop_hours_older_than_24h(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Allflame", C, D, 380, 1)]})
        rates.merge_page(state, H + 20 * rates.HOUR, {"markets": [market("Allflame", C, D, 760, 2)]})
        rates.prune(state, H + 26 * rates.HOUR)
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["dayA"], p["dayB"]), (760, 2))

    def test_backfill_out_of_order_still_counts_older_hours(self):
        state = rates.empty_state()
        rates.merge_page(state, H + rates.HOUR, {"markets": [market("Allflame", C, D, 760, 2)]})
        rates.merge_page(state, H, {"markets": [market("Allflame", D, C, 1, 380)]})  # reversed pair order
        rates.prune(state, H + 2 * rates.HOUR)
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["volA"], p["dayA"], p["dayB"]), (760, 1140, 3))

    def test_no_orders_marks_rows_whose_given_currency_had_no_stock(self):
        # The Sun vs Chaos: 2194 cards on offer, no chaos. Want The Sun / Have Chaos has no competing
        # trades (row Sun>Chaos), and Want Chaos / Have The Sun has no available ones (same row).
        sun = "Metadata/Items/DivinationCards/DivinationCardTheSun"
        page = {"markets": [market("Allflame", sun, C, 0, 0, stock=(2194, 0)), market("Allflame", C, D, 380, 1)]}
        rows, present = rates.no_orders(page)
        self.assertEqual(rows, {"Allflame": ["DivinationCardTheSun>CurrencyRerollRare"]})
        self.assertEqual(present["Allflame"]["CurrencyRerollRare|DivinationCardTheSun"], {"DivinationCardTheSun": 2194, C.rsplit("/", 1)[-1]: 0})

    def test_rates_view_lists_no_orders_per_league(self):
        state = rates.empty_state()
        sun = "Metadata/Items/DivinationCards/DivinationCardTheSun"
        api = FakeApi({H: [market("Allflame", C, D, 380, 1), market("Allflame", sun, C, 0, 0, stock=(2194, 0))]})
        state["nextChangeId"] = H
        rates.update(state, api, H + rates.HOUR + 600)
        view = rates.rates_view(state)
        self.assertEqual(view["noOrdersHour"], H)
        self.assertEqual(view["leagues"]["Allflame"]["noOrders"], ["DivinationCardTheSun>CurrencyRerollRare"])

    def test_pair_missing_from_latest_hour_has_no_orders_either_way(self):
        # Prismatic Fossil vs Divine traded 4h ago but isn't in the latest digest at all.
        fossil = "Metadata/Items/Currency/CurrencyDelveCraftingElemental"
        state = rates.empty_state()
        state["nextChangeId"] = H
        api = FakeApi({
            H: [market("Allflame", C, D, 380, 1), market("Allflame", D, fossil, 1, 21)],
            H + rates.HOUR: [market("Allflame", C, D, 380, 1)],
        })
        rates.update(state, api, H + 2 * rates.HOUR + 600)
        no = rates.rates_view(state)["leagues"]["Allflame"]["noOrders"]
        self.assertEqual(no, ["CurrencyDelveCraftingElemental>CurrencyModValues", "CurrencyModValues>CurrencyDelveCraftingElemental"])

    def test_rates_view_adds_latest_stock_to_listed_pairs(self):
        state = rates.empty_state()
        state["nextChangeId"] = H
        rates.update(state, FakeApi({H: [market("Allflame", C, D, 380, 1, stock=(5000000, 900))]}), H + rates.HOUR + 600)
        p = rates.rates_view(state)["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual(p["stock"], [5000000, 900])  # in the pair's a/b order (Chaos, Divine)

    def test_recent_totals_cover_the_last_4_finished_hours(self):
        state = rates.empty_state()
        state["nextChangeId"] = H
        pages = {H + i * rates.HOUR: [market("Allflame", C, D, 100 * (i + 1), i + 1)] for i in range(6)}  # 100..600
        rates.update(state, FakeApi(pages), H + 6 * rates.HOUR + 600)
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual((p["recentA"], p["recentB"]), (300 + 400 + 500 + 600, 3 + 4 + 5 + 6))
        self.assertEqual(p["dayA"], 2100)

    def test_league_kinds(self):
        self.assertEqual(rates.league_kind("Allflame"), "challenge-softcore")
        self.assertEqual(rates.league_kind("Hardcore Allflame"), "hardcore")
        self.assertEqual(rates.league_kind("Ruthless Allflame"), "ruthless")
        self.assertEqual(rates.league_kind("HC Ruthless Allflame"), "ruthless")
        self.assertEqual(rates.league_kind("HC Allflame"), "hardcore")
        self.assertEqual(rates.league_kind("Standard"), "standard")
        self.assertEqual(rates.league_kind("Limey Whelps (PL86569)"), "private")


class UpdateTests(unittest.TestCase):
    def test_first_run_backfills_and_stops_at_unfinished_hour(self):
        now = H + 2 * rates.HOUR + 600
        start = now // rates.HOUR * rates.HOUR - rates.LOOKBACK
        pages = {start + i * rates.HOUR: [market("Allflame", C, D, 380 + i, 1)] for i in range(24)}
        api = FakeApi(pages)
        state = rates.empty_state()

        fetched = rates.update(state, api, now)

        self.assertEqual(fetched, 24)
        self.assertEqual(state["nextChangeId"], start + 24 * rates.HOUR)
        p = state["leagues"]["Allflame"]["pairs"]["CurrencyModValues|CurrencyRerollRare"]
        self.assertEqual(p["volA"], 380 + 23)
        self.assertEqual(state["leagues"]["Allflame"]["chaosVolume"], 380 + 23)

    def test_next_run_resumes_from_saved_id(self):
        state = rates.empty_state()
        state["nextChangeId"] = H
        api = FakeApi({H: [market("Allflame", C, D, 380, 1)]})
        self.assertEqual(rates.update(state, api, H + rates.HOUR + 600), 1)
        self.assertEqual(api.calls, [H, H + rates.HOUR])
        self.assertEqual(state["nextChangeId"], H + rates.HOUR)

    def test_prunes_pairs_older_than_lookback(self):
        state = rates.empty_state()
        rates.merge_page(state, H, {"markets": [market("Allflame", C, D, 380, 1)]})
        state["nextChangeId"] = H + 30 * rates.HOUR
        rates.update(state, FakeApi({}), H + 30 * rates.HOUR)
        self.assertEqual(state["leagues"], {})

    def test_catch_up_is_capped(self):
        now = H + 100 * rates.HOUR
        state = rates.empty_state()
        state["nextChangeId"] = H
        pages = {H + i * rates.HOUR: [] for i in range(100)}
        self.assertEqual(rates.update(state, FakeApi(pages), now), rates.MAX_PAGES)
        self.assertEqual(state["nextChangeId"], H + rates.MAX_PAGES * rates.HOUR)



E = "Metadata/Items/Currency/CurrencyAddModToRare"  # Exalted Orb, a PoE2 hub


class GameTests(unittest.TestCase):
    """Path of Exile 2: same API and data, but its hubs are Divine, Exalted and Chaos."""

    POE2 = rates.GAMES["poe2"]["hubs"]

    def test_poe2_tracks_pairs_against_exalted(self):
        state = rates.empty_state()
        page = {"markets": [market("Forbidden Rites", V, E, 5, 100), market("Forbidden Rites", E, D, 683, 1)]}
        rates.merge_page(state, H, page, self.POE2)
        self.assertEqual(sorted(state["leagues"]["Forbidden Rites"]["pairs"]),
                         ["CurrencyAddModToRare|CurrencyModValues", "CurrencyAddModToRare|HarvestSeedGreen"])
        poe1 = rates.empty_state()
        rates.merge_page(poe1, H, {"markets": [market("Allflame", V, E, 5, 100)]})
        self.assertEqual(poe1["leagues"], {}, "PoE1's hubs are still just Chaos and Divine")

    def test_poe2_prune_keeps_exalted_pairs(self):
        state = rates.empty_state()
        state["nextChangeId"] = H
        rates.update(state, FakeApi({H: [market("Forbidden Rites", V, E, 5, 100)]}), H + rates.HOUR + 600, self.POE2)
        self.assertIn("CurrencyAddModToRare|HarvestSeedGreen", state["leagues"]["Forbidden Rites"]["pairs"])

    def test_poe2_hc_leagues_are_hardcore(self):
        self.assertEqual(rates.league_kind("HC Forbidden Rites"), "hardcore")

    def test_fetch_page_puts_the_realm_in_the_path(self):
        urls = []

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return b'{"next_change_id": 1}'

        real = rates.urllib.request.urlopen
        rates.urllib.request.urlopen = lambda req, timeout: urls.append(req.full_url) or Resp()
        try:
            rates.fetch_page(H, "ua")
            rates.fetch_page(H, "ua", "poe2")
        finally:
            rates.urllib.request.urlopen = real
        self.assertEqual(urls, [f"https://web.poecdn.com/api/currency-exchange/{H}",
                                f"https://web.poecdn.com/api/currency-exchange/poe2/{H}"])


class HandlerTests(unittest.TestCase):
    """The Lambda handler runs each game into its own keys; one failing doesn't stop the other."""

    def run_handler(self, put_fails_for=(), pages=None, store=None):
        """The handler's result, the keys it wrote and the lines it logged (kept out of the test output).
        `pages` ({hour: markets}) is served to both games, from the hour in their saved state; `store` is the bucket's
        objects before the run, and holds every object after it."""
        import contextlib
        import io
        import os
        import sys
        import types

        written = {}
        store = {} if store is None else store

        class NoSuchKey(Exception):
            pass

        class S3:
            exceptions = types.SimpleNamespace(NoSuchKey=NoSuchKey, ClientError=type("ClientError", (Exception,), {}))

            def get_object(self, Bucket, Key):
                if Key not in store:
                    raise NoSuchKey()
                return {"Body": io.BytesIO(store[Key]["Body"])}

            def put_object(self, Bucket, Key, Body, **kw):
                if any(Key.startswith(p) for p in put_fails_for):
                    raise PermissionError(f"AccessDenied {Key}")
                written[Key] = Body
                store[Key] = {"Body": Body, **kw}

        sys.modules["boto3"] = types.SimpleNamespace(client=lambda name: S3())
        os.environ.update(BUCKET="b", SITE_URL="https://rainofchaos.app")
        real = rates.fetch_page
        api = FakeApi(pages or {})  # no pages: already caught up
        rates.fetch_page = lambda cid, ua, realm="": api(cid)
        log = io.StringIO()
        try:
            with contextlib.redirect_stdout(log):
                result = rates.handler({}, None)
            return result, written, log.getvalue().splitlines()
        finally:
            rates.fetch_page = real
            del sys.modules["boto3"]

    def test_writes_each_game_to_its_own_keys(self):
        result, written, _ = self.run_handler()
        self.assertEqual(sorted(written), ["html/poe2/rates.json", "html/rates.json", "job/poe2/state.json", "job/state.json"])
        self.assertEqual(result["failed"], [])

    def test_one_game_failing_still_updates_the_other(self):
        result, written, log = self.run_handler(put_fails_for=("job/poe2/",))
        self.assertEqual(sorted(written), ["html/rates.json", "job/state.json"])
        self.assertEqual(result["failed"], ["poe2"])
        self.assertIn('{"game": "poe2", "error": "PermissionError(\'AccessDenied job/poe2/state.json\')"}', log)  # logged, not raised


class HistoryTests(unittest.TestCase):
    """Every merged hour is kept in its own gzipped file per game, history/<game>/<UTC day>/<HH>.json.gz."""

    KEY = "history/poe1/2026-10-03/18.json.gz"  # H is 2026-10-03 18:00 UTC
    run_handler = HandlerTests.run_handler

    def start(self, hour):
        """A bucket whose saved states resume at `hour`."""
        state = {**rates.empty_state(), "nextChangeId": hour}
        body = rates.json.dumps(state).encode()
        return {"job/state.json": {"Body": body}, "job/poe2/state.json": {"Body": body}}

    def history(self, store, game="poe1"):
        """The game's history files: {key: content}."""
        out = {}
        for key, obj in store.items():
            if key.startswith(f"history/{game}/"):
                self.assertEqual((obj["ContentType"], obj["CacheControl"]), ("application/gzip", "no-store"))
                out[key] = rates.json.loads(rates.gzip.decompress(obj["Body"]))
        return out

    def test_hour_lands_in_its_own_file(self):
        store = self.start(H)
        page = [market("Allflame", C, D, 380, 1, low=(380, 1), high=(400, 1), stock=(5000, 9), top=(5600, 12)),
                market("Allflame", V, P, 7, 3), market("Ruthless Allflame", C, D, 5, 1)]
        result, _, _ = self.run_handler(pages={H: page}, store=store)
        self.assertEqual(result["failed"], [])
        self.assertEqual(self.history(store), {self.KEY: {
            "game": "poe1", "hour": H, "fields": rates.HISTORY_FIELDS, "leagues": {"Allflame": [
                [["CurrencyRerollRare", "CurrencyModValues"], [380, 1], [5000, 9], [5600, 12], [380, 1], [400, 1]],
                [["HarvestSeedGreen", "HarvestSeedBlue"], [7, 3], [1, 1], [1, 1], [1, 1], [1, 1]],
            ]}}}, "every market, even item to item; Ruthless skipped")
        self.assertEqual(list(self.history(store, "poe2")), ["history/poe2/2026-10-03/18.json.gz"])

    def test_two_runs_write_two_files(self):
        store = self.start(H)
        self.run_handler(pages={H: [market("Allflame", C, D, 380, 1)]}, store=store)
        self.run_handler(pages={H + rates.HOUR: [market("Allflame", C, D, 760, 2)]}, store=store)
        files = self.history(store)
        self.assertEqual(sorted(files), [self.KEY, "history/poe1/2026-10-03/19.json.gz"])
        self.assertEqual(files["history/poe1/2026-10-03/19.json.gz"]["leagues"]["Allflame"][0][1], [760, 2])

    def test_hour_read_again_overwrites_its_file(self):
        # As a backfill does: the state is reset to an hour that already has a file.
        store = self.start(H)
        self.run_handler(pages={H: [market("Allflame", C, D, 380, 1)], H + rates.HOUR: [market("Allflame", C, D, 5, 1)]}, store=store)
        store.update(self.start(H))
        self.run_handler(pages={H: [market("Allflame", C, D, 999, 3)]}, store=store)
        files = self.history(store)
        self.assertEqual(sorted(files), [self.KEY, "history/poe1/2026-10-03/19.json.gz"])
        self.assertEqual(files[self.KEY]["leagues"], {"Allflame": [[["CurrencyRerollRare", "CurrencyModValues"], [999, 3], [1, 1], [1, 1], [1, 1], [1, 1]]]})

    def test_hours_across_midnight_go_under_two_days(self):
        last = H + 5 * rates.HOUR  # 23:00 UTC
        store = self.start(last)
        self.run_handler(pages={last: [market("Allflame", C, D, 380, 1)], last + rates.HOUR: [market("Allflame", C, D, 760, 2)]}, store=store)
        self.assertEqual(sorted(self.history(store)), ["history/poe1/2026-10-03/23.json.gz", "history/poe1/2026-10-04/00.json.gz"])

    def test_failed_history_write_still_writes_rates_and_state(self):
        store = self.start(H)
        result, written, log = self.run_handler(put_fails_for=("history/poe1/",), pages={H: [market("Allflame", C, D, 380, 1)]}, store=store)
        self.assertEqual(sorted(written), ["history/poe2/2026-10-03/18.json.gz", "html/poe2/rates.json", "html/rates.json",
                                           "job/poe2/state.json", "job/state.json"])
        self.assertEqual(rates.json.loads(written["job/state.json"])["nextChangeId"], H + rates.HOUR)
        self.assertEqual(result, {"pages": {"poe1": 1, "poe2": 1}, "failed": ["poe1/history"]})
        self.assertIn('{"game": "poe1", "history": "history/poe1/2026-10-03/18.json.gz", '
                      '"error": "PermissionError(\'AccessDenied history/poe1/2026-10-03/18.json.gz\')"}', log)


if __name__ == "__main__":
    unittest.main()
