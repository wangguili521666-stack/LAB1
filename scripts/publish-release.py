#!/usr/bin/env python3
"""Publish an immutable Git tag and release notes after a successful deployment."""
import json, os, re, subprocess, sys

def publish(meta, repo, gh):
    revision, release = meta['revision'], meta['release']
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or not re.fullmatch(re.escape(revision)+r'-[0-9]+-[0-9]+', release):
        raise ValueError('Invalid release identity')
    run, attempt = release[len(revision)+1:].split('-')
    if str(meta['run']) != run or str(meta['attempt']) != attempt:
        raise ValueError('Release metadata does not match CI identity')
    source = json.loads(gh(['api', f'repos/{repo}/actions/runs/{run}']))
    if not (source['head_sha']==revision and source['head_branch']=='main' and source['conclusion']=='success'
            and source['path']=='.github/workflows/ci.yml' and source['event'] in ['push','workflow_dispatch']
            and str(source['run_attempt'])==attempt):
        raise ValueError('Release must match successful main CI')
    tag='prod-'+release
    refs=json.loads(gh(['api',f'repos/{repo}/git/matching-refs/tags/{tag}']))
    exact=[r for r in refs if r['ref']=='refs/tags/'+tag]
    if exact and (exact[0]['object']['type']!='commit' or exact[0]['object']['sha']!=revision):
        raise ValueError('Existing tag points to a different object; refusing to move it')
    if not exact:
        gh(['api','--method','POST',f'repos/{repo}/git/refs','-f','ref=refs/tags/'+tag,'-f','sha='+revision])
    # Pagination also covers repositories with more than 100 historical releases.
    releases=json.loads(gh(['api','--paginate','--slurp',f'repos/{repo}/releases?per_page=100']))
    if any(r['tag_name']==tag for page in releases for r in page):
        return tag
    notes=(f'Production release: `{release}`\n\nCommit: `{revision}`\n\n'
           f'Source CI: https://github.com/{repo}/actions/runs/{run}\n\n'
           f'Schema fingerprint: `{meta["schema"]}`\n\n'
           'Published after successful approved deployment. Changes below are generated from repository history. '
           'Rollback requires a retained successful version with the same schema fingerprint.')
    gh(['release','create',tag,'--repo',repo,'--verify-tag','--title',tag,'--generate-notes','--notes',notes])
    return tag

if __name__=='__main__':
    def gh(args): return subprocess.check_output(['gh',*args],text=True)
    print(publish(json.load(open(sys.argv[1])),os.environ['GITHUB_REPOSITORY'],gh))
