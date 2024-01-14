using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface IModifierService
{
    Task<List<ModifierModel>> GetByProductOptionId(int productOptionId);
}