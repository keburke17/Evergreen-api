import { Pathway, Provider, DataField, Enrollment } from '@/models';
import { compact, map, uniq, filter } from 'lodash';
import DataFieldService from '@/services/datafield';
import SequelizeHelperService from '@/services/sequelize-helper';
import PathwayService from '@/services/pathway';
import OfferService from '@/services/offer';

const express = require('express');

const router = express.Router();

export default class Controller {
  constructor({ app, prefix, finale }) {
    this.pathwayResource = finale.resource({
      model: Pathway,
      endpoints: [prefix, `${prefix}/:id`],
      include: [
        { model: Provider, attributes: ['id', 'name', 'location'] },
        { model: DataField },
      ],
    });

    this.pathwayResource.create.write_after(async (req, res, context) => {
      const { topics = [], groups_of_offers = [] } = req.body;

      const datafields = compact([...topics]);

      const {
        includeLoadInstruction: datafieldsLoad,
      } = await DataFieldService.addToModel(
        context.instance,
        datafields,
        'pathways_datafields',
        'pathway_id',
      );

      const {
        includeLoadInstruction: groupsLoad,
      } = await PathwayService.connectGroupsOfOffers(
        context.instance,
        groups_of_offers,
      );

      context.instance = await SequelizeHelperService.load(context.instance, [
        datafieldsLoad,
        groupsLoad,
      ]);

      return context.continue;
    });

    this.pathwayResource.create.send_before(async (req, res, context) => {
      context.instance.dataValues.GroupsOfOffers = await PathwayService.loadOffersPathways(
        context.instance,
      );

      return context.continue;
    });

    this.pathwayResource.list.send_before(async (req, res, context) => {
      for (const pathway of context.instance) {
        pathway.dataValues.GroupsOfOffers = await PathwayService.loadOffersPathways(
          pathway,
        );
      }

      return context.continue;
    });

    this.pathwayResource.read.send_before(async (req, res, context) => {
      context.instance.dataValues.GroupsOfOffers = await PathwayService.loadOffersPathways(
        context.instance,
      );

      return context.continue;
    });

    this.pathwayResource.update.write_after(async (req, res, context) => {
      const { topics: newTopics = [], groups_of_offers } = req.body;

      const datafields = compact([...newTopics]);

      const {
        includeLoadInstruction: groupsLoad,
      } = await PathwayService.connectGroupsOfOffers(
        context.instance,
        groups_of_offers,
      );

      const {
        includeLoadInstruction: datafieldsLoad,
      } = await DataFieldService.addToModel(
        context.instance,
        datafields,
        'pathways_datafields',
        'pathway_id',
      );
      context.instance = await SequelizeHelperService.load(context.instance, [
        datafieldsLoad,
        groupsLoad,
      ]);

      return context.continue;
    });

    this.pathwayResource.update.send_before(async (req, res, context) => {
      context.instance.dataValues.GroupsOfOffers = await PathwayService.loadOffersPathways(
        context.instance,
      );

      return context.continue;
    });

    router.post(
      '/generate_userpathway_chart_data',
      this.generateUserPathwayChartData,
    );

    app.use(prefix, router);
  }

  async generateUserPathwayChartData(req, res) {
    const { student_id, pathway_id, group_name } = req.body;

    const pathway = await Pathway.findByPk(pathway_id);

    let offersPathways = await PathwayService.loadOffersPathways(pathway);

    if (group_name) {
      offersPathways = offersPathways.filter(v => v.group_name === group_name);
    }

    const semesters = uniq(map(offersPathways, 'semester'));

    const statuses = [];

    for (const op of offersPathways) {
      let status = await OfferService.checkStudentEnrollStatus(
        student_id,
        op.offer_id,
      );

      // Treating approved and completed as the same thing
      if (status === 'Approved') {
        status = 'Completed';
      }

      statuses.push({
        status,
        semester: op.semester,
      });
    }

    const { STATUSES } = Enrollment;

    const datasets = [];

    const backgroundColors = {
      Activated: 'rgb(0,0,255)',
      Completed: 'rgb(0,255,0)',
      Approved: 'rgb(0,255,0)',
      Unenrolled: 'rgba(255,255,0,0.2)',
      Failed: 'rgb(255,99,132)',
    };

    const inAppLabels = {
      Activated: 'Enrolled',
      Completed: 'Passed',
      Approved: 'Passed',
      Unenrolled: 'Unenrolled',
      Failed: 'Failed',
    };

    for (const status of STATUSES) {
      if (status === 'Inactivate' || status === 'Approved') {
        continue;
      }

      const statusObj = {
        label: inAppLabels[status],
        backgroundColor: backgroundColors[status],
      };

      const data = [];

      for (const semester of semesters) {
        const checkStatus = filter(statuses, { semester, status });
        data.push(checkStatus.length);
      }

      statusObj.data = data;
      datasets.push(statusObj);
    }

    return res.status(200).send({ labels: semesters, datasets });
  }
}
