'use strict';

const debug = require('debug')('wb:post');
const $p = require('./metadata');
const {serialize_prod} = require('./get');

debug('required');


// формирует json описания продукции заказа
async function calc_order(ctx, next) {

  const {_query, route} = ctx;
  const res = {ref: route.params.ref, production: []};
  const {cat, doc, utils, job_prm} = $p;
  const {contracts, nom, inserts, clrs} = cat;

  try {
    if(!utils.is_guid(res.ref)){
      ctx.status = 404;
      ctx.body = `Параметр запроса ref=${res.ref} не соответствует маске уникального идентификатора`;
      return;
    }

    const o = await doc.calc_order.get(res.ref, 'promise');
    const dp = $p.dp.buyers_order.create();
    dp.calc_order = o;

    let prod;
    if(o.is_new()) {
      await o.after_create();
    }
    else {
      if(o.posted) {
        ctx.status = 403;
        ctx.body = `Запрещено изменять проведенный заказ ${res.ref}`;
        return o.unload();
      }
      if(o.obj_delivery_state == 'Отправлен' && _query.obj_delivery_state != 'Отозван') {
        ctx.status = 403;
        ctx.body = `Запрещено изменять отправленный заказ ${res.ref} - его сначала нужно отозвать`;
        return o.unload();
      }
      prod = await o.load_production();
      o.production.clear();
    }

    // включаем режим загрузки, чтобы в пустую не выполнять обработчики при изменении реквизитов
    o._data._loading = true;

    // заполняем шапку заказа
    o.date = utils.moment(_query.date).toDate();
    o.number_internal = _query.number_doc;
    if(_query.note){
      o.note = _query.note;
    }
    o.obj_delivery_state = 'Черновик';
    if(_query.partner) {
      o.partner = _query.partner;
    }
    if(o.contract.empty() || _query.partner) {
      o.contract = contracts.by_partner_and_org(o.partner, o.organization);
    }
    o.vat_consider = o.vat_included = true;

    // допреквизиты: бежим структуре входного параметра, если свойства нет в реквизитах, проверяем доп
    for(const fld in _query) {
      if(!o._metadata(fld) && job_prm.properties[fld]){
        let finded;
        const property = job_prm.properties[fld];
        //const value = property.type.date_part && property.type.types.length == 1 ? new Date(_query[fld]) : _query[fld];
        o.extra_fields.find_rows({property}, (row) => {
          row.value = _query[fld];
          finded = true;
          return false;
        });
        if(!finded){
          o.extra_fields.add({property, value: _query[fld]});
        }
      }
    }

    // подготавливаем массив продукций
    for (let row of _query.production) {
      if(!nom.by_ref[row.nom] || nom.by_ref[row.nom].is_new()) {
        if(!inserts.by_ref[row.nom] || inserts.by_ref[row.nom].is_new()) {
          ctx.status = 404;
          ctx.body = `Не найдена номенклатура или вставка ${row.nom}`;
          return o.unload();
        }
        row.inset = row.nom;
        delete row.nom;
      }
      if(row.clr && row.clr != utils.blank.guid && !clrs.by_ref[row.clr]) {
        ctx.status = 404;
        ctx.body = `Не найден цвет ${row.clr}`;
        return o.unload();
      }
      const prow = dp.production.add(row);
    }

    // добавляем строки продукций и материалов
    const ax = await o.process_add_product_list(dp);
    await Promise.all(ax);
    o.obj_delivery_state = _query.obj_delivery_state == 'Отозван' ? 'Отозван' : (_query.obj_delivery_state == 'Черновик' ? 'Черновик' : 'Отправлен');

    // записываем
    await o.save();

    // формируем ответ
    serialize_prod({o, prod, ctx});
    o.unload();
  }
  catch (err) {
    ctx.status = 500;
    ctx.body = err ? (err.stack || err.message) : `Ошибка при расчете параметрической спецификации заказа ${res.ref}`;
    debug(err);
  }

}

// формирует json описания продукций массива заказов
async function array(ctx, next) {

  ctx.body = `Prefix: ${ctx.route.prefix}, path: ${ctx.route.path}`;
  //ctx.body = res;
}

// сохраняет объект в локальном хранилище отдела абонента
async function store(ctx, next) {

  // данные авторизации получаем из контекста
  let {_auth, _query} = ctx;

  if(typeof _query == 'object'){
    const {doc} = $p.adapters.pouch.remote;
    if(Array.isArray(_query)){
      _query = {rows: _query};
    }
    _query._id = `_local/store.${_auth.suffix}.${ctx.params.ref || 'mapping'}`;
    ctx.body = await doc.get(_query._id)
      .catch((err) => null)
      .then((rev) => {
      if(rev){
        _query._rev = rev._rev
      }
    })
      .then(() => doc.put(_query));
  }
}

// возвращает список документов
async function docs(ctx, next) {

  const {_auth, params, _query} = ctx;
  const {couch_local, zone} = $p.job_prm;

  const {selector} = _query;

  if (!selector.class_name) {
    ctx.status = 403;
    ctx.body = {
      error: true,
      message: `Не указан класс объектов в селекторе`,
    };
  }
  else {
    const _s = {'class_name': selector.class_name};
    const point = selector.class_name.indexOf('.');
    const md_class = selector.class_name.substr(0, point);
    const data_mgr = $p.md.mgr_by_class_name(selector.class_name);
    const md = data_mgr.metadata();

    if(md.cachable == 'doc') {
      if (md_class == 'doc') {
        if (selector.date) {
          _s.date = selector.date;
        }
        else {
          _s.date = {'$ne': null};
        }
      }

      if (selector.search) {
        _s.search = selector.search;
      }
      else {
        _s.search = {$ne: null};
      }

      const predefined_keys = new Set();
      predefined_keys.add('class_name');
      predefined_keys.add('date');
      predefined_keys.add('search');

      for (const key in selector) {
        if (!predefined_keys.has(key)) {
          _s[key] = selector[key];
        }
      }

      const pouch = new $p.classes.PouchDB(couch_local + zone + '_doc_' + _auth.suffix, {
        auth: {
          username: _auth.username,
          password: _auth.pass
        },
        skip_setup: true
      });

      _query.selector = _s;

      const res = await pouch.find(_query);

      //разыменование
      res.docs.forEach((doc)=>{
        representation(doc, md);
      })

      ctx.body = res;
    }
    else
    {
      ctx.body = [];
    }
  }
}

function representation(obj, md) {
  const fake_data_mgr = $p.doc.calc_order;

  function get_new_field(_obj, field, type) {
    const data_mgr = fake_data_mgr.value_mgr(_obj, field, type, false, _obj[field]);

    if (data_mgr && (data_mgr.metadata().cachable == 'ram' || data_mgr.metadata().cachable == 'doc_ram')) {
      const field_obj = data_mgr.get(_obj[field]);

      const point = data_mgr.class_name.indexOf('.');
      const md_class = data_mgr.class_name.substr(0, point);

      const new_field = {'ref': _obj[field]};
      new_field._mixin(field_obj, (md_class == 'doc') ? ['number_doc', 'date'] : ['id', 'name'], []);

      _obj[field] = new_field;

      return;
    }
    return;
  }

  //реквизиты
  for (const field in md.fields) {
    if (obj[field]) {
      get_new_field(obj, field, md.fields[field].type);
    }
  }

  //табличные части
  for (const ts in md.tabular_sections) {
    if (obj[ts]) {
      const fields = md.tabular_sections[ts].fields;

      obj[ts].forEach((row) => {
        for (const field in fields) {
          if(row[field]){
            get_new_field(row, field, fields[field].type);
          }
        }
      })

    }
  }
}

// возаращает конкретный документ по ссылке
async function doc(ctx, next) {

  const {_query, route, params, _auth} = ctx;
  const ref = route.params.ref;
  const {couch_local, zone} = $p.job_prm;

  const data_mgr = $p.md.mgr_by_class_name(ctx.params.class);
  const md = data_mgr.metadata();
  const res = {docs: []};

  if(md.cachable == 'doc'){
    const pouch = new $p.classes.PouchDB(couch_local + zone + '_doc_' + _auth.suffix, {
      auth: {
        username: _auth.username,
        password: _auth.pass
      },
      skip_setup: true
    });

    const obj = await pouch.get(ctx.params.class + '|' + ref);
    res.docs.push(obj);
  }
  else{
    const obj = data_mgr.get(ref);
    res.docs.push(obj);
  }

  representation(res.docs[0], md);

  ctx.body = res;
}

//Запускает загрузку данных из doc
async function load_doc_ram(ctx, next) {
  $p.adapters.pouch.load_doc_ram();
  ctx.body = {'doc_ram_loading_started': true};
}

module.exports = async (ctx, next) => {

  try {
    switch (ctx.params.class) {
      case 'doc.calc_order':
        return await calc_order(ctx, next);
      case 'array':
        return await array(ctx, next);
      case 'store':
        return await store(ctx, next);
      case 'docs':
        return await docs(ctx, next);
      case 'load_doc_ram':
        return load_doc_ram(ctx, next);
      default:
        if(/(doc|cat|cch)\./.test(ctx.params.class)){
          return await doc(ctx, next);
        }

        ctx.status = 404;
        ctx.body = {
          error: true,
          message: `Неизвестный класс ${ctx.params.class}`,
        };
    }
  }
  catch (err) {
    ctx.status = 500;
    ctx.body = {
      error: true,
      message: err.stack || err.message,
    };
    debug(err);
  }

};
