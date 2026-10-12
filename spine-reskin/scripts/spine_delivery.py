#!/usr/bin/env python3
"""Validate semantic changes and rename/copy complete paired Spine resources."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from types import SimpleNamespace
import spine_reskin as core


def differences(old,new,path=''):
    if type(old)!=type(new):return [{'path':path or '/', 'before':old,'after':new}]
    result=[]
    if isinstance(old,dict):
        for key in sorted(set(old)|set(new)):
            pointer=path+'/'+key.replace('~','~0').replace('/','~1')
            if key not in old or key not in new:result.append({'path':pointer,'before':old.get(key),'after':new.get(key),'key_added_or_removed':True})
            else:result.extend(differences(old[key],new[key],pointer))
    elif isinstance(old,list):
        if len(old)!=len(new):return [{'path':path or '/','before_length':len(old),'after_length':len(new)}]
        for i,(a,b) in enumerate(zip(old,new)):result.extend(differences(a,b,path+'/'+str(i)))
    elif old!=new:result.append({'path':path or '/','before':old,'after':new})
    return result


def verify(args):
    captured=io.StringIO()
    with contextlib.redirect_stdout(captured):
        core.cmd_validate(SimpleNamespace(json=args.json,atlas=args.atlas,baseline_json=None,baseline_atlas=args.baseline_atlas))
    report=json.loads(captured.getvalue())
    if args.baseline_json:
        changes=differences(core.read_json(args.baseline_json),core.read_json(args.json))
        allow=args.allow_json_path
        core.require(all(p.startswith('/') and p!='/' and not p.endswith('/') for p in allow),'Use narrow, exact JSON Pointer paths')
        denied=[c for c in changes if not any(c['path']==p or c['path'].startswith(p+'/') for p in allow)]
        core.require(not denied,f'Unexpected JSON change paths: {[c["path"] for c in denied]}')
        report.update({'json_byte_identical':Path(args.baseline_json).read_bytes()==Path(args.json).read_bytes(),'allowed_json_paths':allow,'json_changes':changes})
    else:core.require(not args.allow_json_path,'Allowed paths require --baseline-json')
    report['runtime_test']=False
    output=core.fresh_output(args.out,[args.json,args.atlas])
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        stage=Path(tmp)/'result';stage.mkdir();core.write_json(stage/'validation.json',report);stage.rename(output)
    print(f'Validated resources and allowed JSON change paths: {output}')


def rename(args):
    core.require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',args.name) is not None,'Use a portable file stem without directories')
    core.require(args.name.split('.')[0].upper() not in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]},'Reserved filename')
    source_json=Path(args.json).resolve();source_atlas=Path(args.atlas).resolve()
    core.inspect_resources(source_json,source_atlas)
    pages=core.parse_atlas(source_atlas)
    sources=[source_json,source_atlas]+[core.within(source_atlas.parent,p['name']) for p in pages]
    original_hashes={str(p):core.digest(p) for p in sources}
    core.require(not Path(args.out).is_symlink(),'Output cannot be a symlink')
    output=Path(args.out).resolve()
    exists=output.exists()
    if exists:
        core.require(args.overwrite and output.is_dir(),'Output exists; updating requires --overwrite and a new --backup directory')
        core.require(args.backup is not None,'Overwrite requires a backup directory')
    else:core.require(not args.overwrite,'--overwrite requires an existing output directory')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        stage=Path(tmp)/'result';stage.mkdir()
        json_name=args.name+'.json';atlas_name=args.name+'.atlas'
        shutil.copyfile(source_json,stage/json_name)
        page_names=[]
        for i,page in enumerate(pages):
            name=args.name+('' if i==0 else '_'+str(i+1))+'.png'
            shutil.copyfile(core.within(source_atlas.parent,page['name']),stage/name)
            page_names.append({'before':page['name'],'after':name});page['name']=name
        (stage/atlas_name).write_text(core.serialize_atlas(pages),encoding='utf-8')
        core.inspect_resources(stage/json_name,stage/atlas_name)
        core.require((stage/json_name).read_bytes()==source_json.read_bytes(),'JSON bytes changed during rename')
        core.write_json(stage/'writeback_report.json',{'name':args.name,'page_names':page_names,'source_hashes':original_hashes,'json_byte_identical':True,'unrelated_destination_files_preserved':True})
        targets=[p.name for p in stage.iterdir()]
        core.require(all((output/n).resolve() not in sources for n in targets),'Refusing to overwrite source resources')
        if not exists:stage.rename(output)
        else:
            backup=core.fresh_output(args.backup,[*sources,output])
            core.require(not backup.is_relative_to(output),'Backup must be outside destination directory')
            backup.mkdir()
            previous=set()
            for name in targets:
                dest=output/name
                core.require(not dest.is_symlink() and (not dest.exists() or dest.is_file()),'Target is a symlink/directory')
                if dest.exists():shutil.copyfile(dest,backup/name);previous.add(name)
            core.write_json(backup/'backup_manifest.json',{'destination':str(output),'existing_files':sorted(previous),'new_files':sorted(set(targets)-previous)})
            written=[]
            try:
                for name in targets:os.replace(stage/name,output/name);written.append(name)
                core.inspect_resources(output/json_name,output/atlas_name)
                core.require(all(core.digest(p)==h for p,h in original_hashes.items()),'Source resource hash changed')
            except Exception:
                for name in written:
                    if name in previous:shutil.copyfile(backup/name,output/name)
                    else:(output/name).unlink()
                raise
    core.require(all(core.digest(p)==h for p,h in original_hashes.items()),'Source resource hash changed')
    print(f'Renamed paired resources: {output}; sources preserved')


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    for command in ('verify','rename'):
        q=sub.add_parser(command);q.add_argument('--json',required=True);q.add_argument('--atlas',required=True);q.add_argument('--out',required=True)
        if command=='verify':
            q.add_argument('--baseline-json');q.add_argument('--baseline-atlas');q.add_argument('--allow-json-path',action='append',default=[])
        else:
            q.add_argument('--name',required=True);q.add_argument('--overwrite',action='store_true');q.add_argument('--backup')
    args=p.parse_args()
    try:verify(args) if args.command=='verify' else rename(args)
    except (ValueError,OSError,KeyError,TypeError) as exc:p.exit(2,f'ERROR: {exc}\n')


if __name__=='__main__':main()
