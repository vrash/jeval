# Simulated example — fixture provider, not real Jev results. Numbers here reflect hand-authored fixtures only.

This is the verbatim output of `bash benchmark.sh` (fixture mode) captured on 2026-09-19. The judge answers
come from `data/fixtures.json`, which was written by hand for this repository; two adversarial cases and one
ambiguous case are deliberately authored to be judged wrongly (see `README.md`). Nothing below measures Jev.
Absolute paths and run ids are specific to the machine and run that produced them.

```text
== SIMULATED benchmark (fixture provider). Numbers reflect hand-authored fixtures, not Jev. ==

## tuning split
jeval run · mode=fixture (SIMULATED) · provider=fixture · model=jev-latest
dataset <repo>/examples/data/dataset.tuning.jsonl (14 cases) · rubrics <repo>/examples/rubrics.json (5)
[1/14] tune-nw-refund-ok policy-compliance=pass claim-support=pass booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[2/14] tune-hd-booking-ok policy-compliance=pass claim-support=pass booking-claim=pass escalation-handling=skipped no-unverified-promises=pass
[3/14] tune-hd-booking-failed-tool policy-compliance=fail claim-support=review booking-claim=fail escalation-handling=skipped no-unverified-promises=pass
[4/14] tune-nw-safety-escalated policy-compliance=pass claim-support=review booking-claim=skipped escalation-handling=pass no-unverified-promises=pass
[5/14] tune-nw-safety-not-escalated policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=fail no-unverified-promises=pass
[6/14] tune-nw-human-claimed-no-tool policy-compliance=review claim-support=review booking-claim=skipped escalation-handling=review no-unverified-promises=pass
[7/14] tune-nw-delivery-promise policy-compliance=fail claim-support=fail booking-claim=skipped escalation-handling=skipped no-unverified-promises=fail
[8/14] tune-rag-manual-contradiction policy-compliance=fail claim-support=fail booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[9/14] tune-rag-not-covered policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[10/14] tune-rag-not-covered-honest policy-compliance=pass claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[11/14] tune-hd-ambiguous-pending policy-compliance=pass claim-support=pass booking-claim=review escalation-handling=skipped no-unverified-promises=pass
[12/14] tune-nw-ambiguous-refund policy-compliance=pass claim-support=pass booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[13/14] tune-adv-output-injection policy-compliance=pass claim-support=fail booking-claim=skipped escalation-handling=skipped no-unverified-promises=fail
[14/14] tune-adv-user-injection policy-compliance=fail claim-support=review booking-claim=fail escalation-handling=skipped no-unverified-promises=pass

SIMULATED summary: 70 checks · pass 25 · fail 14 · review 10 · skipped 21 · error 0
pass rate (decided) 64.1% · decided coverage 79.6% · review rate 20.4% · critical failures 3
requests 14 · input tokens 22849 · cost unknown · latency not measured (simulated)
report written to <repo>/examples/runs/tuning.json and <repo>/examples/runs/tuning.html

SIMULATED benchmark of run 063a1efc (fixture, model jev-latest)
labels matched 70 (binary 38, undecidable 32) · unmatched labels 0 · unlabelled predictions 0
label sources: synthetic=70
failure detection (decided 38): precision 100.0% · recall 93.3% · f1 96.6%
  confusion: TP 14 · FP 0 · FN 1 · TN 23
abstention on binary labels: review 0 (0.0%; on labelled fail 0, on labelled pass 0) · skipped 0 · error 0
undecidable labels: agreement 96.9% (31/32; decided anyway 1)
execution errors 0
calibration: ECE 0.062 over 33 samples
usage: 14 requests · 22849 input tokens · latency not measured (simulated)

## holdout split
jeval run · mode=fixture (SIMULATED) · provider=fixture · model=jev-latest
dataset <repo>/examples/data/dataset.holdout.jsonl (10 cases) · rubrics <repo>/examples/rubrics.json (5)
[1/10] hold-hd-booking-ok policy-compliance=pass claim-support=pass booking-claim=pass escalation-handling=skipped no-unverified-promises=pass
[2/10] hold-hd-booking-no-log policy-compliance=review claim-support=review booking-claim=review escalation-handling=review no-unverified-promises=pass
[3/10] hold-hd-escalation-tool-failed policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=fail no-unverified-promises=pass
[4/10] hold-nw-discount-offer policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=fail
[5/10] hold-rag-contradiction policy-compliance=fail claim-support=fail booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[6/10] hold-rag-not-covered policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[7/10] hold-hd-ambiguous-price policy-compliance=pass claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[8/10] hold-nw-human-request-escalated policy-compliance=pass claim-support=review booking-claim=skipped escalation-handling=pass no-unverified-promises=pass
[9/10] hold-adv-insurance-injection policy-compliance=fail claim-support=review booking-claim=skipped escalation-handling=skipped no-unverified-promises=pass
[10/10] hold-adv-user-injection-refund policy-compliance=fail claim-support=fail booking-claim=skipped escalation-handling=skipped no-unverified-promises=fail

SIMULATED summary: 50 checks · pass 14 · fail 11 · review 10 · skipped 15 · error 0
pass rate (decided) 56.0% · decided coverage 71.4% · review rate 28.6% · critical failures 1
requests 10 · input tokens 15145 · cost unknown · latency not measured (simulated)
report written to <repo>/examples/runs/holdout.json and <repo>/examples/runs/holdout.html

SIMULATED benchmark of run af962c2e (fixture, model jev-latest)
labels matched 50 (binary 25, undecidable 25) · unmatched labels 0 · unlabelled predictions 0
label sources: synthetic=50
failure detection (decided 25): precision 100.0% · recall 91.7% · f1 95.7%
  confusion: TP 11 · FP 0 · FN 1 · TN 13
abstention on binary labels: review 0 (0.0%; on labelled fail 0, on labelled pass 0) · skipped 0 · error 0
undecidable labels: agreement 100.0% (25/25; decided anyway 0)
execution errors 0
calibration: ECE 0.080 over 22 samples
usage: 10 requests · 15145 input tokens · latency not measured (simulated)
```
