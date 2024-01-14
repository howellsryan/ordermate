using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class ModifierService : IModifierService
{
    private readonly IModifierRepository _modifierRepository;

    public ModifierService(IModifierRepository modifierRepository)
    {
        _modifierRepository = modifierRepository;
    }

    public async Task<List<ModifierModel>> GetByProductOptionId(int productOptionId)
    {
        var modifiers = await _modifierRepository.GetByProductOptionId(productOptionId);

        return MapResultsToApi(modifiers, productOptionId);
    }
    
    private List<ModifierModel> MapResultsToApi(IEnumerable<DAL.Models.ModifierModel> dataModel, int productOptionId)
    {
        var result = new List<ModifierModel>();

        foreach (var modifier in dataModel)
        {
            result.Add(MapDalObjectToApiModel(modifier, productOptionId));
        }

        return result;
    }

    private ModifierModel MapDalObjectToApiModel(DAL.Models.ModifierModel dalProductOption, int productOptionId)
    {
        return new ModifierModel
        {
            ModifierId = dalProductOption.ModifierId,
            ProductOptionId = productOptionId,
            Name = dalProductOption.Name,
            Price = dalProductOption.Price,
            Quantity = dalProductOption.Quantity,
            LastModifiedDate = dalProductOption.LastModifiedDate,
            CreatedDate = dalProductOption.CreatedDate
        };
    }
}